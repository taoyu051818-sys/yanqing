# 需求追踪矩阵

| 需求 | 实现 | 数据与规则 | 验收证据 |
|---|---|---|---|
| FR-01 场地与时段 | 小程序订场矩阵；`venues` 模块 | 20 场地、8 时段、价格有效期、订单锁场 | 并发唯一约束、微信构建 |
| FR-02 会员与五账户 | 个人中心、会员卡、充值、账户明细；`members`/`memberships` | 五种 `AccountType` 独立余额与追加流水 | 账户隔离单测、非负 DB 约束 |
| FR-03 主理人球局 | 活动页与球局运营中心；`games` | 申请审批、报名支付、实到签到、按实到奖励 | 状态校验、事务与审计 |
| FR-04 固定双打瑞士制 | 赛事页；`events` + shared | 24–48 人、5 轮、避免重复、让分、21 分封顶、纠错排名 | 瑞士配对/让分/比分单测 |
| FR-05 培训独立经营账 | 培训页与培训运营中心；`training` | 预收、消课确认、成本、占场时长、退款 | 20%/零场地费服务与 DB 约束 |
| FR-06 羽球币与直接推荐 | 钱包；`referrals` | 只有 `referrerId` 一层；首付观察期；退款冲回 | 自荐/改绑/账户隔离单测 |
| FR-07 唯一联盟券 | 券包与商户核销台；`alliance` | 唯一码、商户作用域、归因 GMV、拉新、ROI | 条件核销、唯一索引、风险事件 |
| FR-08 商品库存 | 金羽小店与库存预警；`goods`/`inventory` | 采购/寄售、销售出库、退货回库、安全库存 | 支付事务条件扣减、库存 DB 约束 |
| FR-09 财务结算 | 老板驾驶舱；`dashboard`/`reports` | 场馆/培训分账、联盟结算、Excel 导出 | 财务单测、导出审计 |
| FR-10 权限审计参数 | 经营中心与后台治理；全局守卫、`audit`/`configuration` | 多角色、商户作用域、参数生效版本、订单快照 | API 构建、E2E、审计记录 |
| FR-11 管理中心待办与审批 | 今日营业/工作台分组、退款/消课/比分/券/库存/结算任务；`work-items` | 按责任角色、状态、优先级和数据范围分派；maker/checker | work-items 单测、角色切换和 14 条旅程 |
| FR-12 日结与账期锁定 | 财务工作台日结卡片；`reconciliation` | Asia/Shanghai 营业日、阻断项、OPEN→REVIEW→LOCKED、锁定快照幂等 | ReconciliationService 单测、API 路由和审计 |
| FR-13 微信小程序交付 | uni-app `mp-weixin` 构建、测试 AppID、角色演示通道 | `compileType=miniprogram`；mock/remote 显式区分；上传前 HTTPS 与真实 AppID | 小程序类型检查/构建；开发者工具与真机记录 |

## 合同硬规则

| 规则 | 服务层 | 数据库层 | 测试层 |
|---|---|---|---|
| 培训有效收入 × 20% | `trainingContractContributionCents` | rate=2000 且金额公式 CHECK | shared 与 TrainingService 测试 |
| 培训不另收场地费 | 结算恒返回 0 | `venueFeeCents=0` CHECK | shared 与 TrainingService 测试 |
| 无多级推荐 | 仅 `User.referrerId` 与单个奖励接收人 | 单一外键，无层级奖励表 | 自荐/改绑测试 |
| 五账户隔离 | 支付渠道只映射一个账户 | `(userId,type)` 唯一、余额非负 | 账户隔离测试 |
| 券只核销一次 | 状态条件更新和幂等键 | code/idempotency 唯一、核销完整性 CHECK | 状态机测试 |
