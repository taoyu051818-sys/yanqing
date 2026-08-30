# 部署与微信小程序发布

## 环境变量

复制 `apps/api/.env.example` 并设置：

- `DATABASE_URL`：PostgreSQL 连接串。
- `JWT_SECRET`：不少于 32 个随机字符，生产环境使用密钥管理服务。
- `CORS_ORIGINS`：仅列出真实 Web 管理端域名。
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

## 小程序发布

1. 本地开发和短期预览可直接使用仓库配置的测试 AppID `wxa457599ec4c27ad1`；该测试号已被微信开发者工具明确判定为“不支持上传”。需要开发版上传、体验版或正式发布时，必须先在 `apps/miniapp/src/manifest.json` 的 `mp-weixin.appid` 换成发布方有权限且支持上传的小程序 AppID，重新构建，并确认产物 `project.config.json` 的 `compileType` 为 `miniprogram`。
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

## 上线闸门

- 将 `NODE_ENV` 设为 `production`，确认开发登录返回 401。
- 关闭 `PAYMENT_PROVIDER=mock` 前，完成微信支付下单、签名、通知验签、退款和日对账验收。
- 抽查培训结算：合同分成为有效收入 20%，场地费和场馆应付款均为 0。
- 对重复券核销、余额不足、库存不足、并发订场和重复支付做压力重试。
- 备份恢复演练成功后才开放真实用户。
