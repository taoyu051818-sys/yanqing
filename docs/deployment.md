# 生产部署、健康检查与恢复

本文是当前生产操作入口。历史 Compose/H5 模板与旧迁移数字移至 [历史部署参考](deployment-history.md)，不作为当前上线依据。

## 当前部署结构

- 服务器：`ubuntu@42.193.229.164`；项目根目录 `/home/ubuntu/yanqing-domain`。
- API：systemd `yanqing-api`，监听 `127.0.0.1:33200`；Nginx 提供 `https://api.yutechhn.cn/api/v1`。
- 实际版本：`systemctl show yanqing-api -p WorkingDirectory --value` 指向的目录及其中 `RELEASE.json`。不要把 GitHub 最新提交、旧文档或 `/source` 当作线上版本。
- 数据库：宿主机 PostgreSQL 16，生产迁移以目标库与发布清单逐一校验为准；CI 使用 PostgreSQL 17，服务器恢复验收额外验证实际版本。
- API 环境文件 `.env.api`，老板摘要配置 `.env.boss`；不复制进发布包、不输出内容。开发登录必须关闭。
- PC 后台继续使用 `/var/www/yanqing-admin/current`，入口 `/admin/`；本流程只切换 API。旧公开 H5 保持下线。
- 小程序是独立发布物；更新服务器不会自动更新微信客户端。

## 合并与验证

工作分支提交 → GitHub `Verify production applications / verify` 通过 → 合并主分支 → 主分支同一提交检查通过 → 构建该提交的发布包。

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/api prisma:generate
pnpm lint
pnpm verify
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/yanqing_test pnpm test:core-lifecycle
```

数据库矩阵只连接明确指定的本机 `_test` 库。CI 同时执行共享包、API、小程序、PC、HTTP、运维回滚测试及生产构建。不能把跳过数据库测试记为通过；不能用其他提交的 CI 代替目标提交。测试数量不代表覆盖率。

## 打包与准备

当前脚本只支持**数据库结构和 API 依赖不变**的发布。有新迁移或服务端依赖变化会拒绝准备，需先制定对应迁移/依赖安装与兼容回退方案。客户端 importer 的独立变化允许通过，所有包解析结果与 API/shared importer 必须一致。

在干净、已提交的工作树执行：

```bash
python3 scripts/prepare-api-release.py /absolute/new/output-directory
```

脚本重新构建 API/shared，生成 `release.tgz`、SHA-256、完整 Git 提交编号、文件校验清单、Schema 与各迁移校验和。用户未跟踪的文档不打包；密钥和 node_modules 不打包。

把发布包与仓库 `deploy/ops/release.sh` 传到服务器的新收件目录。下列 `COMMIT` 和 `SHA256` 分别替换为本次完整提交编号和包摘要：

```bash
bash /absolute/inbox/release.sh prepare /absolute/inbox/release.tgz SHA256 COMMIT
```

准备阶段互斥执行：校验文件 → 新建独立 release → 校验 API 依赖及目标库全部迁移 → 备份生产库 → 实际恢复到新建隔离库 → 用新版编译产物执行订场支付退款与权限验收 → 注入隔离数据库断连并验证 503/恢复 → 删除隔离库。生产业务数据不参与写入验收。

证据保存在 `ops/receipts/COMMIT/` 与 `backups/verified/时间戳/`。只有备份、恢复、业务验收全部成功，才写入可激活标记。准备失败时线上版本保持原状；不手工补标记。

## 激活与核对

```bash
bash /absolute/inbox/release.sh activate COMMIT
systemctl show yanqing-api -p WorkingDirectory -p ActiveState -p NRestarts
curl --fail --max-time 5 https://api.yutechhn.cn/api/v1/health/ready
```

激活再次校验备份摘要、验收时间、源版本、配置文件与候选文件；切换后检查本机及公网数据库就绪状态和完整提交编号。失败自动恢复原 systemd 覆盖配置并重启原版本。应用回滚不恢复数据库。

- `/health`：进程存活检查，兼容旧监控，不代表数据库正常。
- `/health/ready`：数据库 `SELECT 1` 成功返回 200，失败/超过 2 秒返回 503。并发探测共享未结束的查询，避免故障时不断占用连接。
- 健康响应禁止缓存；只公开服务名、状态、提交编号和时间，不公开连接地址、凭据或数据库错误。

## 应用回滚

```bash
bash /absolute/inbox/release.sh rollback COMMIT
```

`COMMIT` 是要撤回的当前发布编号。脚本要求当前目录和配置仍匹配该发布，恢复记录中的原配置，核验原服务和未变更的数据库。旧版本没有 readiness 接口时采用进程检查加数据库迁移检查。只有复核通过才记为回滚成功；失败必须查看 `journalctl -u yanqing-api` 与 receipt。

不得用恢复旧数据库作为普通回滚，否则会覆盖发布后的新订单和支付。数据库灾难恢复需先停止写入、确认损失时间窗口，在新库完成恢复和账务核对后再制定切换操作。备份是每日快照，不能承诺零数据丢失。

## 定时备份与运维检查

安装与升级工具时，将本次 release 的 `deploy/ops/run.sh` 复制到 `ops/run.sh`，把本次工具 release 的绝对路径写入 `ops/tooling-release`，安装 `deploy/ops/yanqing-{backup,health}.{service,timer}` 到 `/etc/systemd/system/`，执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yanqing-backup.timer yanqing-health.timer
sudo systemctl start yanqing-backup.service
sudo systemctl start yanqing-health.service
systemctl list-timers yanqing-backup.timer yanqing-health.timer
```

- 每日服务器时间 03:30 加最多 5 分钟随机延迟：生成受限权限备份，并恢复到临时库验证全部迁移；成功后才更新 `backups/verified/latest-verified.json`。发布和备份使用同一把锁。
- 每分钟：核对本机/公网 readiness 与实际提交、最近成功备份不超过 32 小时、磁盘至少剩余 1 GiB 且不少于 10%。异常令检查服务失败；状态变化写入 journal，结果保存在 `ops/health.json`。
- 工具目录独立于运行版本选择，应用回滚仍可执行备份；回退到不提供 readiness 的历史版本时，健康检查会提示异常。
- 这些是服务器内的检测与记录，尚不等于短信、微信或独立外部探活告警。监控与业务同机也无法报告整机失联。
- 当前备份保留在本机，不自动删除历史备份。异地加密副本及保留策略尚需配置；本机备份无法覆盖整机磁盘损坏。

人工核对入口：

```bash
cat /home/ubuntu/yanqing-domain/ops/health.json
cat /home/ubuntu/yanqing-domain/backups/verified/latest-verified.json
journalctl -u yanqing-health -u yanqing-backup --since today --no-pager
```

## 微信小程序与现场验收

正式构建必须指定远端模式和 HTTPS 地址：

```bash
VITE_DATA_MODE=remote VITE_API_BASE_URL=https://api.yutechhn.cn/api/v1 pnpm build:miniapp
```

使用微信开发者工具导入 `apps/miniapp/dist/build/mp-weixin`，确认 AppID、开发者授权和合法域名后上传体验版。实际上传及审核方式见 [微信开发者工具说明](wechat-devtools.md)。任何本地/H5/服务端测试都不能替代真机验收。

现场至少分别使用会员、前台/管理员与好友账号测试：订场并真实微信支付、退出不支付和超时释放、重复下单、取消/退款、管理员代订后会员付款、管理员/前台特殊代订、球局与积分赛分享直达/报名付款、双方订单状态和老板摘要一致。记录订单号、微信交易状态与验收时间，不在公开文档记录个人资料或凭据。

## 环境变量与全新测试库

配置字段以 `apps/api/.env.example` 和启动校验为准。正式收费使用真实微信商户配置，`JWT_SECRET`、微信/LLM 凭据仅保存在服务器受限文件。`DEV_LOGIN_ENABLED=true` 仅允许隔离开发/测试环境。

全新隔离测试库可运行 `db:deploy`、`db:seed`。生产库禁止重复灌种或手工改表。迁移历史、寄售旧单切换等历史约束见 [历史参考](deployment-history.md) 和 [寄售切换审计](consignment-cutover.md)。
