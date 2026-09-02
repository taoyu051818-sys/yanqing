# 部署与微信小程序发布

## 环境变量

复制 `apps/api/.env.example` 并设置：

- `DATABASE_URL`：PostgreSQL 连接串。
- `JWT_SECRET`：不少于 32 个随机字符，生产环境使用密钥管理服务。
- `CORS_ORIGINS`：仅列出确需浏览器访问 API 的受信调试或运维来源；微信小程序 request 合法域名仍在微信公众平台单独配置。
- `WECHAT_APP_ID`、`WECHAT_APP_SECRET`：微信小程序登录凭据。
- `PAYMENT_PROVIDER`：默认 `mock` 用于联调；正式收费设置为 `wechat`。
- `WECHAT_PAY_*`：微信支付商户号、证书序列号、商户私钥、平台证书、API v3 Key 与支付/退款通知地址。真实模式已实现 JSAPI 下单、小程序 RSA 调起参数、通知验签、AES-GCM 解密、金额校验、幂等入账、退款申请和退款成功通知回账；上线仍须用实际商户资料完成微信侧验收。

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

种子数据包含 20 片场地、8 个时段、会员产品、成人/青少年课包、主理人球局、48 人瑞士制赛事、联盟商户/券和采购/寄售库存。开发登录账号按角色取最早的一条种子用户：管理员 `13800000001`、前台 `...002`、教练 `...003`、主理人 `...004`、会员 `...005`、商户 `...006`、财务复核 `...007`、超级管理员 `...008`；开发登录不校验手机号，只按角色选择。

2026-09-01 本地验收基线为 29/29 个 Prisma 迁移；代码门禁为 shared 13/13、API 单元/服务 558/558、小程序 106/106、健康接口 E2E 1/1。本机全新 PostgreSQL 的 `migrate status` 最新、Schema diff 为空，种子化验收库已完成真实 HTTP/数据库回放。生产部署签字仍必须引用目标提交的 `pnpm verify`、目标库 29/29 `migrate status`、备份/恢复记录、种子或基线检查和 Schema diff 日志，不能只引用本文或本地验收数字。

### 从旧 17 迁移版本升级到 27

旧交付数据库不得直接替换或手工改表。升级步骤为：停止写入并记录停机点；创建可恢复备份并实际验证恢复；在备份副本演练 `db:deploy`；确认新增 10 个迁移按目录顺序应用；运行种子只限全新测试库，生产库不重复灌种；执行 `migrate status` 和 Schema diff；最后回放会员产品/充值计划/价格规则、推荐双边奖励、退款互锁、履约、试听监管和寄售结算关键旅程。

`20260830200000_consignment_settlements` 之后的寄售订单要求 `OrderItem.metadata.inventorySnapshotVersion=1`。迁移本身不能猜测旧订单当时的供应商合同和佣金，正式切换前必须执行并归档 [寄售应付快照 cutover 审计](consignment-cutover.md)：记录首个版本 1 快照的部署时间，导出旧交易差异清单及 SHA-256，由财务和管理员双人签字；有证据的历史差异走受审批修复方案，无证据项目保持异常披露，禁止按当前佣金批量回填。

## 小程序发布

1. 本地开发和短期预览可使用仓库配置的测试 AppID `wxa457599ec4c27ad1`；该测试号只具备编译/预览能力，微信开发者工具会提示“不支持上传”。本文不声称最终包已经上传或真机通过。需要开发版上传、体验版或正式发布时，必须先在 `apps/miniapp/src/manifest.json` 的 `mp-weixin.appid` 换成发布方有权限且支持上传的小程序 AppID，重新构建，并确认产物 `project.config.json` 的 `compileType` 为 `miniprogram`。
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
