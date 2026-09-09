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

赛事与培训按功能领域组织目录，控制器直接注入对应领域服务。原来的 `EventsService`、`TrainingService` 及两个聚合控制器已删除，模块只负责装配，不再保留业务聚合入口。现有 56 个 HTTP 路由、角色权限与公开分享入口保持不变。

| 目录（apps/api/src/ 下） | 责任 |
| --- | --- |
| events/catalog | 赛事查询、创建、发布；整场取消由单独的取消服务负责 |
| events/invitations | 固定搭档邀请、邀请预览与接受、邀请凭证校验 |
| events/registration | 报名下单、个人参赛状态、签到、候补递补、退出与退款申请 |
| events/competition | 配对、比分、排名重算、轮次推进、完赛 |
| events/prizes | 奖品查询、发放、签收、库存扣减与审计 |
| events/shared | 赛事命令响应、文本与数据库错误处理 |
| training/catalog | 课程产品、班级配置与青训产品校验 |
| training/students | 学员档案、监护关系与可见范围 |
| training/enrollments | 购课报名、课包席位预留、幂等下单 |
| training/schedule | 课次查询、排课、课次完成 |
| training/attendance | 考勤与补课安排 |
| training/consumption | 消课、提交复核、确认消课、合同费率核验 |
| training/corrections | 消课冲正申请、审批、驳回及账本回滚 |
| training/settlements | 经营汇总、结算生命周期、来源账本与锁账期核验 |
| training/shared | 操作权限、命令幂等、有效消课识别规则 |

`EventsModule` 装配 8 个服务与 5 个领域控制器；`TrainingModule` 装配本轮的 8 个服务与 8 个领域控制器，并继续装配既有体验课和青训规则入口。没有增加微服务或进程间调用。

报名、整场取消、退报名是不同业务命令，分别持有自己的事务。共用候补函数在 `events/registration/event-waitlist.ts`，共用席位与退报名标识在 `event-registration-policy.ts`。订单取消、退款、微信支付回调直接引用领域规则；领域函数接收调用方的事务客户端，不另开事务，不代会员扣款。球局同类规则仍在 `games/game-waitlist.ts` 与 `game-registration-policy.ts`。

赛事比赛执行继续细分为 `competition/event-rounds.ts`、`event-scoring.ts`、`event-completion.ts`、`event-standings.ts`。共用比赛规则在 `event-competition-policy.ts`。培训冲正与结算的命令实现分别位于 `corrections/training-consume-corrections.ts`、`settlements/training-settlements.ts`；薄服务提供 Nest 注入入口，私有校验留在所属领域内。审批人与申请人分离、幂等、并发条件、锁账期及原有事务边界保持不变。

跨领域调用只共享必要规则和事务函数，不能传入整个服务对象或通过继承恢复聚合服务。原有回归场景通过 `test/support/*-service-fixture.ts` 组合真实领域服务；它们只有转发代码，只供测试使用，构建排除 `test/`。架构测试禁止生产源码引用这些测试组合器，并检查共享订单代码与领域服务的导入链和订单状态写入边界。

`test/domain-modules.e2e-spec.ts` 加载真实模块、控制器和领域服务，依据拆分前固化的 56 条路由合约，检查路径、公开标记、角色、实际 HTTP 分发以及普通会员越权拒绝。该装配测试替换业务方法返回值；真实业务行为和数据库事务由下述数据库验收覆盖。它不代替微信真机或真实支付验收。

本轮拆出的赛事服务最大 599 行，培训服务最大 542 行。既有体验课服务约 961 行、消课冲正命令文件约 767 行仍较大，但各自属于明确领域；后续应根据独立业务流程继续拆分，而非只按行数切文件。本轮未调整页面、数据库结构或管理员/前台代订绕过权限。

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
