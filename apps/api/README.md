# 延庆金羽 API

这是延庆金羽会员生态系统的 NestJS API，负责认证、场地、订单支付与退款、培训独立核算、球局、瑞士赛事、联盟券、库存、财务日结和审计。

## 本地运行

在仓库根目录执行：

```bash
docker compose up -d postgres
pnpm --dir apps/api db:deploy
pnpm --dir apps/api db:seed
pnpm dev:api
```

健康检查：

```bash
curl http://127.0.0.1:3200/api/v1/health
```

环境变量模板见 [`.env.example`](.env.example)。开发登录只允许非生产环境使用；正式微信登录需要服务端配置 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。真实支付还需要微信支付商户证书及通知地址。

## 开发命令

```bash
pnpm --dir apps/api test
pnpm --dir apps/api test:e2e
pnpm --dir apps/api lint
pnpm --dir apps/api build
pnpm --dir apps/api prisma:validate
pnpm --dir apps/api prisma:generate
```

接口清单、角色范围、幂等要求和反向流程见 [`docs/api.md`](../../docs/api.md)；部署、HTTPS、微信登录和支付配置见 [`docs/deployment.md`](../../docs/deployment.md)。

## 业务硬约束

- 培训预收与消课收入分开；有效培训收入的 20% 形成场馆合同流水，培训占场不生成应付场地费。
- 现金本金、赠送余额、羽球币、成人赛事积分和青少年成长积分使用独立账本。
- 推荐只有一层；联盟商户各自收款，场馆储值余额不能跨商户支付。
- 退款、支付回调、库存、券核销、奖励和结算均要求幂等；已入账记录只能冲正或调整并保留审计。
