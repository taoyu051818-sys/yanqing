# API 与角色矩阵

所有接口前缀为 `/api/v1`。除 `/health`、`/auth/wechat-login` 和开发环境的 `/auth/dev-login` 外，均需 `Authorization: Bearer <JWT>`。成功响应统一为 `{ code: 0, message: "ok", data, requestId }`；失败响应携带相同 `requestId` 便于审计定位。运行服务后可在 `/docs` 查看 Swagger，在 `/docs/openapi.json` 获取 OpenAPI JSON。

| 模块 | 主要接口 | 允许角色 |
|---|---|---|
| 认证 | `POST /auth/wechat-login`、`GET /auth/me` | 公开登录/已登录 |
| 场地 | `GET /venues/availability`、`POST /venues/bookings`、`POST /venues/orders/:id/check-in` | 会员/前台 |
| 会员账户 | `GET /members/:id`、`POST /members/:id/accounts/adjust`、`POST /members/me/referrer` | 本人/财务/管理员 |
| 会员卡充值 | `GET /memberships/products`、`POST /memberships/purchase`、`POST /memberships/recharge` | 会员 |
| 订单 | `GET /orders`、`POST /orders/:id/pay`、`POST /orders/:id/refunds`、`POST /orders/refunds/:id/approve` | 本人/财务 |
| 球局 | `GET /games`、`POST /games/hosts/apply`、`POST /games/hosts/:userId/approve`、`POST /games/:id/register`、`POST /games/:id/promote-waitlist`、`POST /games/:id/check-in/:userId`、`POST /games/:id/complete`、`POST /games/rewards/grant-matured` | 会员/主理人/前台/财务/管理员 |
| 赛事 | `GET /events/:id`、`POST /events`、`POST /events/:id/publish`、`POST /events/:id/register`、`POST /events/:id/rounds/next`、`POST /events/matches/:id/score`、`POST /events/matches/:id/correct`、`POST /events/:id/finish` | 会员/赛事角色/管理员 |
| 培训 | `GET /training/products`、`POST /training/purchase`、`POST /training/sessions/:id/consume`（教练提交）、`POST /training/sessions/:id/consume/confirm`（管理员确认）、`GET /training/financial-summary`、`POST /training/settlements` | 会员/教练/财务/管理员 |
| 联盟 | `POST /alliance/coupons/:code/claim`、`POST /alliance/coupons/redeem`、`POST /alliance/settlements`、`GET /alliance/settlements`、`POST /alliance/settlements/:id/submit`、`POST /alliance/settlements/:id/confirm`、`POST /alliance/settlements/:id/dispute`、`POST /alliance/settlements/:id/settle` | 会员/商户/财务/管理员 |
| 商品库存 | `GET /goods`、`POST /goods/orders`、`POST /inventory/:id/transactions` | 会员/员工 |
| 配置审计 | `GET /parameters`、`POST /parameters`、审计查询 | 财务/管理员 |
| 经营待办 | `GET /work-items?limit=50` | 前台/教练/赛事/财务/管理员等内部角色 |
| 日结关账 | `GET /reconciliation/periods/:date`、`POST /reconciliation/periods/:date/close` | 财务/管理员；OPEN→REVIEW→LOCKED |
| 驾驶舱导出 | `GET /dashboard`、`GET /reports/exports/:scope.xlsx` | 财务/管理员 |

Excel 导出范围：`orders`、`members`、`training`、`alliance`、`inventory`、`audit`。

## 幂等键

支付、账户调整、库存变更和联盟券核销要求客户端提交稳定的 `idempotencyKey`。网络重试必须复用同一键；新的业务动作必须生成新键。

## 时间和金额

- API 时间使用 ISO 8601；业务日按 `Asia/Shanghai` 计算。
- 金额字段以 `Cents` 结尾，单位为人民币分。
- 羽毛球币和积分是独立整数单位，不默认等同于人民币；兑换取订单日期有效参数。

## 球局候补与递补

`POST /games/:id/register` 在席位已满或已有更早候补时返回 `WAITLISTED` 记录和 `waitlistPosition`，不会提前创建或收取订单。全额退款释放席位时，系统在同一事务中将最早候补改为 `REGISTERED`、生成新的待支付订单并留下 `GAME_WAITLIST_PROMOTED` 审计；前台/财务也可调用 `POST /games/:id/promote-waitlist` 手动重试。会员只有完成新订单支付后才进入 `PAID`，候补本身不产生收入或主理人奖励。

## 日结关账

业务日按 `Asia/Shanghai` 的自然日计算。`GET` 只读返回实时快照；`POST /reconciliation/periods/:date/close` 会检查待处理退款、支付和周期结算。存在阻断项时落 `REVIEW`，清理后可再次提交；无阻断时落 `LOCKED`。已锁定日重复请求返回原快照且不重复写审计，历史订单和账本只能通过冲正/调整单处理。
