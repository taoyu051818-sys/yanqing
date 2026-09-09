# 核心订单生命周期与验收约定

本轮目标是收拢现有业务规则，让一条规则的修改同时作用于所有支付渠道。没有更换框架、拆微服务或扩展 PC 功能，也没有更改管理员/前台代订的时间与冲突绕过权限。

## 状态修改边界

已有订单的状态修改统一通过 `apps/api/src/orders/order-transition.ts`：

| 命令 | 原状态 → 目标状态 |
| --- | --- |
| PAY | PENDING → PAID |
| CANCEL_UNPAID | PENDING → CANCELLED |
| CANCEL_FREE | PAID/CHECKED_IN → CANCELLED，必须携带零金额、未履约条件 |
| CHECK_IN | PAID → CHECKED_IN |
| COMPLETE | PAID/CHECKED_IN → COMPLETED；部分退款保留财务状态，补记履约时间 |
| REQUEST_REFUND | 已支付、签到、完成、部分退款 → REFUND_PENDING |
| REJECT_REFUND | REFUND_PENDING → 经业务规则核实的申请前状态 |
| REFUND_SUCCEEDED | 可退款状态 → PARTIALLY_REFUNDED/REFUNDED |
| CAPTURE_COMPENSATION | CANCELLED → REFUND_PENDING；零金额保持 CANCELLED |
| REOPEN_TRAINING | 消课冲正恢复待履约状态，同时保留已有部分退款或待退款状态 |

必须传入订单 ID 与原状态条件，数据库条件更新负责并发竞争。单订单命令用 `requireOrderTransition`，竞争失败会抛出冲突并回滚当前事务；需要处理重复执行的调用方用 `transitionOrder` 检查影响行数。合法状态图不替代业务权限、金额核验、资源核验或审计。

`test/core-architecture.spec.ts` 检查生产源码里的直接 Order 状态写入，防止新模块绕过此入口。这是代码回归检查，不是数据库级权限隔离；原生 SQL、迁移和人工修复仍需单独审查。

## 资源规则的归属

| 阶段 | 共用入口 | 负责的规则 |
| --- | --- | --- |
| 支付前资源预留 | `booking-coupon.ts`、`inventory/goods-stock.ts`、各报名领域规则 | 优惠券归属和独占、商品可售库存、报名资格与保留截止 |
| 支付成功履约 | `payments/order-finalizer.service.ts` | 场地确认、报名激活、课包名单、会员权益、库存实际出库、优惠券核销 |
| 未支付取消 | `orders/pending-order-resources.ts` | 释放本订单场地/优惠券、球局和赛事席位、待支付课包、冻结会员权益，并按领域规则递补 |
| 退款成功 | `orders/refund-resources.ts` | 微信与现金/余额共用；课包退款、未履约场地释放、原库存批次还原、会员权益重排、报名退款及候补递补、推荐奖励冲回 |
| 免费订单取消 | `zero-amount-activity-order.ts`、`zero-amount-venue-order.ts` | 共用状态入口，保留领域差异；场地还要验证未开始、未核销，并归还本订单已核销的优惠券 |
| 迟到支付 | `payments/late-payment.ts` | 记录实际收到的钱，创建需审批的补偿退款；不重新授予权益，也不回退其他订单资源 |

退款资源处理与退款终态落库处于同一事务。部分退款通常保留场地与活动席位；课包按剩余预收余额决定后续可履约名单。已完成、未到场、已消课记录作为历史证据保留。补偿退款没有发生履约，不能增加库存或扣回从未授予的充值余额。

场地占用与优惠券释放由普通取消、超时释放、无法履约的微信回调共用。赛事的历史迟到回调保留原有退款审批标识和审计记录，状态修改也进入统一状态入口。整场活动取消与单个会员退报名仍由各自领域控制，不能互相释放场地。

微信网络调用无法被数据库事务回滚。退款审批发起外部退款，成功通知才执行资源释放；关闭未支付订单仍先核实外部关单结果。不能在履约写入一半后吞掉异常，再假装进入补偿流程。

## 活动与培训模块边界

候补递补入口分别位于 `events/event-waitlist.ts` 和 `games/game-waitlist.ts`。订单取消、退款、微信支付回调和活动管理均直接调用这些领域函数，不再从 `EventsService` / `GamesService` 导入候补函数。调用方继续持有原有事务；递补不会新建独立事务，也不会代会员扣款。

赛事的席位状态、支付保留时间和退出退款标识放在 `events/event-registration-policy.ts`；球局的容量限制与报名状态规则放在 `games/game-registration-policy.ts`。接口 DTO 引用领域容量限制，领域规则不反向依赖带装饰器的 DTO。

`events/event-prizes.ts` 负责奖品查询、发放与签收，包含该流程的权限、幂等核验、库存扣减、并发处理及审计。`training/training-settlements.ts` 负责培训经营汇总和结算单的创建、查询、提交、确认、结算、退回、作废，沿用 `training-settlement-ledger.ts` 的账本来源核验。原有服务方法保留为转发入口，所以控制器、其他业务调用方和 API 合约不变。

独立命令函数显式接收数据库依赖，私有校验函数留在所属文件内。没有通过继承大服务或传入整个服务对象来拆分。`test/core-architecture.spec.ts` 检查指定订单及领域入口的静态相对导入/导出链，防止重新依赖赛事、球局和培训的大服务文件。

赛事配对、比分和完赛分别由 `event-rounds.ts`、`event-scoring.ts`、`event-completion.ts` 负责。`event-competition-policy.ts` 保留共用的赛事配置、固定双打、轮次、配对完整性及管理权限规则；`event-standings.ts` 负责配对或比分纠正后的排名数据重算。固定人数及轮次常量由领域规则定义，DTO 单向引用并保留原常量导出，领域命令不运行时导入 DTO。

培训消课冲正的查询、申请、批准和驳回放在 `training-consume-corrections.ts`。消课确认与冲正共同调用 `training-access.ts` 的审批权限、`training-settlement-ledger.ts` 的锁账期检查。冲正流程仍在同一事务内修改反向流水、课包余额、考勤、成长积分及订单履约状态，不绕过原有申请人与复核人分离、幂等及并发条件。

赛事报名邀请与培训排课、消课确认仍留在原服务中，后续可按各自完整业务流程继续拆分。这两轮没有调整小程序页面、PC 页面或数据库结构。

## 可重复验收入口

```bash
pnpm test:core-lifecycle --list
TEST_DATABASE_URL=postgresql://用户名@127.0.0.1:55440/yanqing_core_test pnpm test:core-lifecycle
# 只验证一个分组
TEST_DATABASE_URL=postgresql://用户名@127.0.0.1:55440/yanqing_core_test pnpm test:core-lifecycle --group training
```

需要已安装依赖、生成 Prisma 客户端、构建 shared 包，并启动本地 PostgreSQL。基础库必须事先创建且名称以 `_test` 结尾。入口自动应用迁移；统计和课包等分组自动创建独立临时数据库，执行后删除，因此本地测试账号需具有创建数据库权限。共享基础库不会自动清空，应使用专用的空验收库。

执行清单在 `apps/api/scripts/core-lifecycle-matrix.json`，本地与 GitHub Actions 使用同一入口。未设置 `TEST_DATABASE_URL`、使用非本地地址或非测试库名会明确失败，不能用测试跳过冒充通过。架构测试同时检查所有集成验收文件均被清单收录且没有重复。

| 业务链路/不变量 | 自动化验收文件（apps/api/test/） |
| --- | --- |
| 原状态条件、非法跳转、支付与取消竞争回滚；三渠道部分/全部退款和重复通知 | order-lifecycle-policy.integration.spec.ts |
| 预支付与取消竞争、迟到支付、充值与退款 | payment-lifecycle.integration.spec.ts |
| 管理员代订及绕过权限、开班交接、核销与关闭场地 | venue-operation-boundaries、operations-boundaries、admission-boundaries |
| 报名权限、保留截止、候补、已开赛支付 | registration-boundaries |
| 商品预留与出库并发、渠道一致性、原批次退货、补偿不虚增库存 | goods-payment-stock |
| 优惠券归属、预支付独占、失效回调补偿、免费取消 | coupon-payment、zero-amount-venue-cancellation、zero-amount-cancellation |
| 会员续期、退款权益重排、课包履约与结算 | entitlement-boundaries、training-refund-roster |
| 资金账本、金额边界、经营摘要、关键事件 | ledger-boundaries、payment-amount-boundaries、reporting-boundaries、boss-event-visibility |
| 线索权限、用户资料与注销边界 | lead-boundaries、privacy-lifecycle |

以上简称均对应 `.integration.spec.ts` 文件。外部微信接口使用测试替身，数据库事务、通知处理和业务服务执行真实代码。真机分享卡片、微信登录、实际收付款及线上网络连通性仍需现场验收，本入口不能证明这些外部环节已经通过。
