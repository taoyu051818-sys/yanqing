# 需求追踪矩阵

| 需求 | 实现 | 数据与规则 | 验收证据 |
|---|---|---|---|
| FR-01 场地与时段 | 小程序订场矩阵、场馆资源价格规则；`venues` 模块 | 20 场地、8 时段、价格规则按编码/有效期版本化、订单冻结价格快照 | 并发唯一约束、价格冲突/幂等测试、微信构建 |
| FR-02 会员与五账户 | 个人中心、会员产品、充值计划、账户明细；`members`/`memberships` | 五种 `AccountType` 独立余额与追加流水；会员产品/充值计划版本启停，充值仅提交服务端 `planId` | 账户隔离与非负 DB 约束、主数据版本/重叠/权限测试 |
| FR-03 主理人球局 | 活动页与球局运营中心；`games` | 申请审批、报名支付、实到签到、按实到奖励 | 状态校验、事务与审计 |
| FR-04 固定双打瑞士制 | 赛事页；`events` + shared | 24–48 人、5 轮、避免重复、让分、21 分封顶、纠错排名 | 瑞士配对/让分/比分单测 |
| FR-05 培训独立经营账 | 培训页与培训运营中心；`training` | 产品/班级/课次、预收、maker/checker 消课、冲正、成本、退款和周期结算 | 20%/零场地费服务与 DB 约束；结算/冲正测试 |
| FR-06 羽球币与直接推荐 | 分享卡、启动归因、个人中心、钱包、老板驾驶舱；`members`/`referrals` | 冷/热启动暂存，登录后本人一次绑定；只有 `referrerId` 一层；首付观察期；邀请人/新客双边参数化奖励；退款前冲回；绑定数/有效首单数 | 自荐/闭环/改绑/并发、双边账户隔离与真实 HTTP+PG 复验 |
| FR-07 唯一联盟券 | 券包与商户核销台；`alliance` | 唯一码、商户作用域、归因 GMV、拉新、ROI | 条件核销、唯一索引、风险事件 |
| FR-08 商品库存 | 金羽小店、库存主数据、库存预警与寄售应付工作台；`goods`/`inventory` | 供应商/SKU/库位详情更新与启停；采购/寄售、销售出库、退货回库、安全库存；寄售履约生成应付、整单退款追加冲正，自营 SKU 不生成应付 | 支付事务条件扣减、主数据状态/幂等测试、2000 迁移约束、ConsignmentSettlementService/迁移契约测试 |
| FR-09 财务结算 | 老板驾驶舱与财务工作台；`dashboard`/`reports`/`inventory/consignment` | 场馆/培训分账、联盟结算、寄售 `DRAFT→PENDING_CONFIRMATION→CONFIRMED→SETTLED` 及争议/退回/作废、Excel 导出 | maker-checker/幂等/关账测试，应付、结算单、明细与流转全量导出 |
| FR-10 权限审计参数 | 经营中心与后台治理；全局守卫、`audit`/`configuration` | 多角色、商户作用域、参数生效版本、订单快照 | API 构建、E2E、审计记录 |
| FR-11 管理中心待办与审批 | 今日营业/工作台分组、退款/消课/比分/券/库存/结算任务；`work-items` | 按责任角色、状态、优先级和数据范围分派；maker/checker | work-items 单测、角色切换和 14 条旅程 |
| FR-12 日结与账期锁定 | 财务工作台日结卡片；`reconciliation` | Asia/Shanghai 营业日；待退款/支付、班次/现金差异、到期未履约订单/培训阻断；OPEN→REVIEW→LOCKED、快照幂等；培训/联盟/寄售周期结算仅预警，历史源流水锁定后仍可周/月制单付款 | ReconciliationService 单测、API/Mock 路由和审计 |
| FR-13 微信小程序交付 | uni-app `mp-weixin` 构建、测试 AppID、角色演示通道 | `compileType=miniprogram`；mock/remote 显式区分；测试号仅预览、不支持上传；上传前 HTTPS 与有权限 AppID | 小程序类型检查/构建；开发者工具现场记录；真机由验收人补证 |
| FR-14 前台班次与现金责任 | 前台工作台；`operations`/`payments` | 开班→现场经办→关班；现金按 `Payment.operatorId` 归属；差异双人复核 | 班次/支付服务测试、真实 HTTP+PG 烟测 |
| FR-15 封场与维护 | 场馆资源工作台；`venues/closures` | 精确场地时间窗、未来订单影响预览、不静默取消、预约事务内阻断 | 封场 API/Mock 测试、微信构建 |
| FR-16 组织、风险与数据治理 | 治理中心；`governance`/`configuration`/`audit`/`reports` | 微信账户授权、多角色和商户作用域、最后超级管理员保护、风险状态机、真实 XLSX | 服务层权限/竞态/审计测试；mock 角色旅程 |
| FR-17 创建幂等与证据链 | 会员、订场、培训、商品、球局、赛事各建单入口 | 操作槽持久键、命令哈希、同键回放、异命令冲突、`createdById` 和同事务审计 | 七入口 API/Mock/前端工具测试 |
| FR-18 隐私注销与传输审计 | 个人中心注销申请、治理中心复核；`privacy` 与全局写请求审计 | 申请/撤回/驳回/完成状态机、业务阻断清单、双人复核、标识符与赛事姓名匿名化、财务凭证匿名 ID 留存；写请求记录 requestId/IP/设备且不记录载荷或 token | PrivacyService/Controller、Mock 旅程、HTTP mutation interceptor 测试与数据库约束 |
| FR-19 试听转化与青少年监管 | 培训运营试听/监管卡片；`training/trials`、`training/youth-rules` | 预约→到课/未到→测评→转化/流失；规则草稿由超级管理员异人发布，产品/订单保存监管快照 | TrainingTrials/YouthTrainingRules 服务与 mock 测试、统一待办 |
| FR-20 退款与履约互锁 | 交易退款、场地/球局/赛事/培训状态动作；`orders`/`payments` | 系统取消强制退款不可驳回；保存退款前订单状态；`REFUND_PENDING` 冻结履约/消课 | refund-origin、event-refund、fulfillment 与各领域冻结测试 |
| FR-21 充值退款短款风险 | 五账户、退款回调和风险治理；`payments`/`governance` | 平台退款成功不因可追回余额不足回滚；只扣可用额并记录 `RECHARGE_REFUND_BALANCE_SHORTFALL` 未追回金额 | 微信通知重放、账户非负/冻结约束与风险事件测试 |
| FR-22 商业主数据版本 | 会员服务会员产品/充值计划、场馆资源价格规则 | 新版本默认停用；编码版本唯一；有效区间/启停冲突；创建/状态命令幂等与审计；历史单据快照不变 | 2020/2010 迁移契约、服务/API/Mock 测试 |
| FR-23 数据升级与寄售 cutover | Prisma 迁移和财务 cutover 清单 | 旧 17 迁移顺序升级到 29；首个寄售快照版本 1 时间；历史缺证交易不按当前规则猜测回填 | 本地全新库 29/29、migrate status/Schema diff 已通过；目标库仍需 cutover SQL 清单、备份恢复记录与双人签字 |

## 合同硬规则

| 规则 | 服务层 | 数据库层 | 测试层 |
|---|---|---|---|
| 培训有效收入 × 20% | `trainingContractContributionCents` | rate=2000 且金额公式 CHECK | shared 与 TrainingService 测试 |
| 培训不另收场地费 | 结算恒返回 0 | `venueFeeCents=0` CHECK | shared 与 TrainingService 测试 |
| 无多级推荐 | 仅 `User.referrerId` 一层；同一转化事件只包含邀请人和新客两个直接参与者 | 单一推荐外键、`(newUserId,triggerType)` 唯一、双边金额非负 | 自荐/改绑、并发首付和双方幂等入账测试 |
| 五账户隔离 | 支付渠道只映射一个账户 | `(userId,type)` 唯一、余额非负 | 账户隔离测试 |
| 券只核销一次 | 状态条件更新和幂等键 | code/idempotency 唯一、核销完整性 CHECK | 状态机测试 |
