# 部署与微信小程序发布

当前服务器状态以 [2026-09-05 双打代填与微信搭档邀请发布记录](releases/2026-09-05-doubles-signup.md) 为准；此前小时订场见 [上一版记录](releases/2026-09-05-hourly-booking-time.md)。API 已通过 systemd 工作目录覆盖切换到独立 release；下文 Compose/旧 source 路径为部署模板，后续更新前先核对实际服务的 WorkingDirectory。原支付配置保持不变，时段目录为 1 小时，历史订单和资金不变；开发登录的生产安全限制仍需单独收口。

## 环境变量

复制 `apps/api/.env.example` 并设置：

- `DATABASE_URL`：PostgreSQL 连接串。
- `JWT_SECRET`：不少于 32 个随机字符，生产环境使用密钥管理服务。
- `CORS_ORIGINS`：仅列出确需浏览器访问 API 的受信调试或运维来源；微信小程序 request 合法域名仍在微信公众平台单独配置。
- `WECHAT_APP_ID`、`WECHAT_APP_SECRET`：微信小程序登录凭据。
- `PAYMENT_PROVIDER`：默认 `mock` 用于联调；正式收费设置为 `wechat`。
- `WECHAT_PAY_*`：微信支付商户号、证书序列号、商户私钥、微信支付公钥 ID/公钥、API v3 Key 与支付/退款通知地址。部署时优先使用 `*_PATH` 从权限受控的文件读取 PEM，不把私钥写入仓库或镜像。系统保留平台证书验签兼容模式，但新接入推荐微信支付公钥模式。真实模式已实现 JSAPI 下单、小程序 RSA 调起参数、微信响应及通知验签、AES-GCM 解密、金额校验、幂等入账、退款申请和退款成功通知回账；上线仍须用实际商户资料完成微信侧验收。

真实商户配置完成后，可执行不创建订单、不扣款的官方安全回显测试：

```bash
node --env-file=/path/to/api.env apps/api/scripts/wechat-pay-security-echo.mjs
```

该测试验证商户号、商户 API 证书私钥/序列号和微信支付公钥 ID/公钥之间的签名链；配置 `WECHAT_PAY_NOTIFY_URL` 时还会请求微信发送加密安全回显通知，可结合回调的 200 访问日志验证公网回调、通知验签和 API v3 Key 解密。

如需额外验证 AppID、商户号和当前小程序用户 `openid` 的绑定关系，可仅在受控验收环境临时注入 `WECHAT_PAY_TEST_OPEN_ID`。脚本会创建 1 分钱的未支付预下单，拿到 `prepay_id` 后立即关单，不会调起用户支付：

```bash
WECHAT_PAY_TEST_OPEN_ID='<测试用户openid>' pnpm --dir apps/api wechat-pay:verify
```

小程序通过 `apps/miniapp/.env` 设置：

```dotenv
VITE_API_BASE_URL=https://api.example.com/api/v1
```

## 数据库

```bash
docker compose up -d postgres
pnpm --dir apps/api db:deploy
pnpm --dir apps/api db:seed
```

种子数据包含 20 片场地、17 个一小时时段（07:00–24:00）、会员产品、成人/青少年课包、主理人球局、48 人瑞士制赛事、联盟商户/券和采购/寄售库存。开发登录账号按角色取最早的一条种子用户：管理员 `13800000001`、前台 `...002`、教练 `...003`、主理人 `...004`、会员 `...005`、商户 `...006`、财务复核 `...007`、超级管理员 `...008`；开发登录不校验手机号，只按角色选择。

2026-09-04 域名验收环境基线为 30/30 个 Prisma 迁移；目标库 `migrate status` 最新、Schema diff 为空，种子化验收库已完成真实 HTTP/数据库回放。代码门禁数字随目标提交变化，生产部署签字必须引用该提交的 `pnpm verify`、目标库 30/30 `migrate status`、备份/恢复记录、种子或基线检查和 Schema diff 日志，不能只引用本文。

### 从旧 17 迁移版本升级到 27

旧交付数据库不得直接替换或手工改表。升级步骤为：停止写入并记录停机点；创建可恢复备份并实际验证恢复；在备份副本演练 `db:deploy`；确认新增 10 个迁移按目录顺序应用；运行种子只限全新测试库，生产库不重复灌种；执行 `migrate status` 和 Schema diff；最后回放会员产品/充值计划/价格规则、推荐双边奖励、退款互锁、履约、试听监管和寄售结算关键旅程。

`20260830200000_consignment_settlements` 之后的寄售订单要求 `OrderItem.metadata.inventorySnapshotVersion=1`。迁移本身不能猜测旧订单当时的供应商合同和佣金，正式切换前必须执行并归档 [寄售应付快照 cutover 审计](consignment-cutover.md)：记录首个版本 1 快照的部署时间，导出旧交易差异清单及 SHA-256，由财务和管理员双人签字；有证据的历史差异走受审批修复方案，无证据项目保持异常披露，禁止按当前佣金批量回填。

## 小程序发布

1. 仓库配置的小程序 AppID 为 `wx25610460bc96894b`。开发版上传、体验版或正式发布前，必须确认当前微信号具有该 AppID 的开发者权限，重新构建，并确认产物 `project.config.json` 的 `compileType` 为 `miniprogram`。本文不声称仅凭配置 AppID 就已经完成上传或真机验收。
2. 将正式 HTTPS API 域名加入微信公众平台“request 合法域名”；证书链必须完整。
3. 设置 API 的同一 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
4. 将 `apps/miniapp/.env` 设为 `VITE_DATA_MODE=remote` 和正式 HTTPS `VITE_API_BASE_URL` 后执行 `pnpm build:miniapp`；保留 `mock` 的构建只能本地演示，不能上传体验版。
5. 微信开发者工具导入 `apps/miniapp/dist/build/mp-weixin`，检查隐私指引、用户信息和扫码权限声明。
6. 使用体验版分别验证会员、员工、主理人、商户和管理员账号，再上传审核。

开发者工具的本地 mock、远端联调、测试身份切换、真机预览和上传步骤见 [docs/wechat-devtools.md](wechat-devtools.md)。预览/正式 AppID 均需管理员授权对应微信号；测试号不可当作生产凭据，Secret 绝不能写入小程序包。

## API 容器

```bash
docker compose up -d --build
curl http://127.0.0.1:3200/api/v1/health
```

容器启动会先执行 `prisma migrate deploy`。上线应配置反向代理 HTTPS、每日数据库快照、7/30/180 天备份层级、日志脱敏和可观测性告警。

ICP备案完成前的香港裸 IP H5 联调环境使用独立 Compose 文件、隔离测试库和显式测试身份，详见 [香港裸 IP H5 联调环境](staging-raw-ip.md)。该环境不承载真实数据，也不能替代微信小程序合法域名和 HTTPS 真机验收。

ICP备案完成后的域名验收环境使用 `deploy/docker-compose.domain.yml`。默认将 H5 发布到 `https://yutechhn.cn/badminton/`，API 独立发布到 `https://api.yutechhn.cn/api/v1`，容器端口仅绑定宿主机回环地址，PostgreSQL 不映射宿主机端口。先为 `api.yutechhn.cn` 添加指向服务器公网 IP 的 A 记录，再用 `deploy/nginx-api.yutechhn.cn.bootstrap.conf` 完成 HTTP/ACME 验证；证书签发后切换为 `deploy/nginx-api.yutechhn.cn.conf`。该环境仍使用隔离演示库、开发身份和 mock 支付，不能录入真实经营或支付数据；接入正式 AppID、微信支付和生产库前必须关闭开发登录并按上线闸门重新验收。

若服务器无法访问 ACME 服务或验证节点无法访问服务器 80 端口，应从可信运维机改用 DNS-01 签发证书，将证书私钥以 `0600 root:root` 安装到服务器，并在验证后删除临时 TXT 记录。手工 DNS 证书不会自动续期，必须监控到期日并在到期前至少 30 天重复签发、安装和 HTTPS 回归。

若目标服务器无法访问 Docker Hub，可复用宿主机 PostgreSQL 的独立数据库，并用 `deploy/yanqing-api.service` 将 API 仅监听 `127.0.0.1`，H5 构建产物交由宿主机 Nginx 发布。该降级方式不得复用其他业务数据库或角色，仍须执行迁移状态、Schema diff、种子数据清点、逻辑备份和公网 HTTPS 回放。

## 上线闸门

- 将 `NODE_ENV` 设为 `production`，确认开发登录返回 401。
- 关闭 `PAYMENT_PROVIDER=mock` 前，完成微信支付下单、签名、通知验签、退款和日对账验收。
- 抽查培训结算：合同分成为有效收入 20%，场地费和场馆应付款均为 0。
- 抽查商业主数据：会员产品、充值计划和价格规则只通过新版本/启停变更，当前目录只暴露有效版本，历史订单快照不变。
- 抽查退款互锁：系统取消退款不可驳回，`REFUND_PENDING` 不能继续履约/消课；充值退款余额不足时退款终态不回滚且风险短款金额可追溯。
- 抽查寄售：订单版本 1 快照、销售应付、整单退款反冲、maker/checker 结算和付款凭证能从订单追到供应商。
- 抽查日结：待退款/支付、开放班次、现金差异和未履约源业务阻断；培训、联盟、寄售周期结算仅预警，能在历史营业日锁定后继续流转。
- 对重复券核销、余额不足、库存不足、并发订场和重复支付做压力重试。
- 备份恢复演练成功后才开放真实用户。
