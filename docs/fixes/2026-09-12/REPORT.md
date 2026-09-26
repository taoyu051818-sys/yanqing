# 全仓审核问题修复与验证报告

日期：2026-09-12。本文是历史记录，不代表当前版本状态；当前任务与验收入口见 [项目状态](../../project-status.md)。

基于 原审核工作单（本机历史文件 `../../audits/2026-09-12/WORKLIST.md`，未纳入仓库） 的32项确认缺陷实施。原审核证据保持不变；本目录单独记录修复结果。仓库中用户已有的球局契约、页面和文档修改均保留，不将它们冒充本次修复。

当前状态：32项确认问题的代码修复与本地回归已完成。机器可读逐项状态见 [status.json](status.json)。本轮仅修改本地代码及合成数据隔离库，未提交或推送 GitHub、未部署、未修改线上业务数据、未发起真实微信资金操作。

## 逐项处理

| 编号 | 修复后的行为 | 验证状态 |
| --- | --- | --- |
| PAY-001 | 审批先提交后出站；原退款号持久重试、主动查询补偿、成功关闭延期风险。 | 本地验证通过 |
| DB-001 | 新增numeric分成约束迁移，保留财务CHECK。 | 本地验证通过 |
| EVENT-001 | 会员退出响应使用明确字段白名单，不返回其他候补队隐私。 | 本地验证通过 |
| OPS-001 | 锁定打包提交并校验根构建输入，构建前后检查版本一致。 | 本地验证通过 |
| PAY-002 | 按累计退款金额计算本金/赠额应回收值，扣除已回收与已记录追缴义务。 | 本地验证通过 |
| GAME-001 | 取消事务把已有活跃退款升级为不可驳回义务，保留原幂等号。 | 本地验证通过 |
| VENUE-001 | 部分退款保留有效场地履约，签到与完成不覆盖部分退款财务状态。 | 本地验证通过 |
| MOPS-003 | 订单、会员与试听支持分页/搜索；待办优先按业务ID定位。 | 本地验证通过 |
| MOPS-005 | 客户360采用会员ID和请求代际绑定，弹窗与提交共用已核验快照。 | 本地验证通过 |
| INV-001 | 盘点录数、提交、过账共享父记录锁及状态检查。 | 本地验证通过 |
| INV-002 | 保留销售引用的历史零分账，退款仍归还原批次。 | 本地验证通过 |
| TRAINING-002 | 未结算的已结课课次可随合法冲正受控重开，保留审计和结算锁。 | 本地验证通过 |
| MOPS-001 | 历史出勤保留结业学员，当前候选与历史流水分别投影。 | 本地验证通过 |
| MOPS-002 | 请假行提供同班后续课次补课入口。 | 本地验证通过 |
| MINI-001 | 会话变化清除账号私有缓存，异步写回检查账号归属。 | 本地验证通过 |
| MINI-002 | 活动刷新采用递增请求代际，阻止旧响应和旧finally覆盖。 | 本地验证通过 |
| MINI-003 | 订场完成后的导航受页面生命周期约束，离页不强制跳走。 | 本地验证通过 |
| MEVENT-001 | 赛事搭档邀请与推荐码分流，保留合法推荐归因。 | 本地验证通过 |
| MOPS-004 | 联盟券核销提供有权限的商户选择。 | 本地验证通过 |
| MOPS-006 | 业务待办按角色和业务ID跳入可处理页面。 | 本地验证通过 |
| MOPS-007 | 空白数字不可发布；明确0合法；确认展示规则、值与生效时间。 | 本地验证通过 |
| MOPS-008 | 普通赛事签到由后端有效规则判断，保留历史补录理由入口。 | 本地验证通过 |
| MEMBER-001 | 教练可见子女关系本身按本人任教/助教范围过滤。 | 本地验证通过 |
| AUTH-001 | 注销提交即撤销头像公开读取，物理清理使用持久可重试任务。 | 本地验证通过 |
| INV-003 | 仅提交变化资料字段，后端按实际时间/null识别效期变化。 | 本地验证通过 |
| INV-004 | 采购、调拨和报损使用真实批次与效期，过账复用幂等键。 | 本地验证通过 |
| WORK-001 | 先在数据库过滤低库存，再排序限制条数。 | 本地验证通过 |
| DASH-001 | 联盟核销与实收分别按实际发生日汇总，避免每天重复整月金额。 | 本地验证通过 |
| DASH-002 | 报名量与有效参与分开，复参统计排除取消等无效状态。 | 本地验证通过 |
| ALLIANCE-001 | 争议退回后的账单可带理由和幂等键修订，保留历史和核销关联。 | 本地验证通过 |
| VENUE-002 | 服务和DTO共同校验真实日历日期。 | 本地验证通过 |
| PC-001 | 待支付筛选改用后端枚举PENDING，新增真实模板到DTO契约测试。 | 本地验证通过 |

## 核心设计与验证依据

退款审批在数据库提交后才请求支付方。`APPROVED` 是持久审批决定，由后台恢复任务继续按原退款号发送；`PROCESSING` 通过退款查询补偿丢失的成功回调。失败和成功的并发写入均不能撤销已审批决定或覆盖成功状态。恢复成功同时关闭延期异常，保留原事件证据；较晚失败的请求不能重新创建过期异常。支付方返回 CLOSED/ABNORMAL 时保留本地退款义务，并给财务明确待核对事件，不根据失败响应猜测资金已退或自动撤销义务。实现参考微信支付的 [退款查询](https://pay.wechatpay.cn/doc/v3/merchant/4012791884) 和 [退款申请说明](https://pay.wechatpay.cn/doc/v3/merchant/4012553002)。外部接口全部由测试替身模拟，没有调用真实支付服务。

充值退款按累计应回收金额减去已回收/已记录追缴义务，避免每笔独立舍入造成少扣或多扣。真实PG覆盖多次25分和50分退款、其他充值赠额保护及余额不足后的待追缴。12项退款回归还覆盖审批/驳回竞争、审批回滚、服务恢复重试、回调先到、主动查询和过期异常闭环。独立复核记录（本机历史文件 `evidence/payment-independent-review.md`，未纳入仓库）。

整场取消在同一事务中把已有普通退款标为必须完成的义务，驳回动作通过带条件更新处理并发。盘点录数、提交及过账使用父记录锁；培训分成通过新增numeric约束迁移解决中间整数溢出，未删除金额限制。头像注销与文件清理解耦：注销提交后旧地址即不可读，物理删除任务在数据库持久保存并可重试，事务回滚不提前删文件。

详细领域记录：球局、赛事、场地、摘要与联盟（本机历史文件 `backend-game-venue-report.md`，未纳入仓库）、培训、会员、库存与待办（本机历史文件 `training-inventory-report.md`，未纳入仓库）、头像注销与PC筛选（本机历史文件 `privacy-pc-report.md`，未纳入仓库）。小程序完整交互证据由 [前端报告](miniapp-report.md) 记录。

## 自动验证

- API全量非数据库测试：118文件、892项通过；另23文件327项数据库用例按设计暂跳过，随后由明确的本地PG矩阵实际运行，不能把跳过算作通过。输出（本机历史文件 `evidence/api-unit-final.log`，未纳入仓库）
- 核心真实PG矩阵：9个分组，45个迁移均在隔离库应用。前8组319项通过；最后头像/搜索组中的头像6项通过，搜索新增夹具缺少订单快照且断言误用了响应中不公开的memberId，已修正为合法完整订单及精确订单ID集合，再单组复跑8项全部通过，9组累计327项真实数据库用例通过。最终结果见 完整初跑（本机历史文件 `evidence/core-lifecycle-final.log`，未纳入仓库） 和 最后分组（本机历史文件 `evidence/privacy-search-final.log`，未纳入仓库），保留初次失败记录。
- HTTP契约14项、共享契约13项、PC既有单测1项通过；PC真实模板→DTO回归也包含在API测试中。HTTP（本机历史文件 `evidence/http-contracts-final.log`，未纳入仓库）、共享（本机历史文件 `evidence/shared-tests-final.log`，未纳入仓库）、PC（本机历史文件 `evidence/admin-tests-final.log`，未纳入仓库）
- 运维14项通过，含7项真实Git+pnpm+Python打包回归：干净版本产出、根构建配置未提交阻断、构建过程中输入或HEAD改变阻断。只在临时fixture仓库提交测试样本，未提交实际项目。输出（本机历史文件 `evidence/ops-regression.log`，未纳入仓库）
- API生产构建、PC生产构建与API lint通过；迁移后schema diff为空。全量API测试中预期的故障注入会输出warn/error，不代表测试失败。API构建（本机历史文件 `evidence/api-build-final.log`，未纳入仓库）、PC构建（本机历史文件 `evidence/admin-build-final.log`，未纳入仓库）、lint（本机历史文件 `evidence/api-lint-final.log`，未纳入仓库）、schema差异（本机历史文件 `evidence/schema-diff-final.sql`，未纳入仓库）
- 小程序全套69文件398项通过，类型检查、微信remote构建、H5 remote构建全部通过。微信主包737,776字节，总包1,568,050字节，mock文件和孤立主包JS均为0。测试（本机历史文件 `evidence/miniapp-tests.log`，未纳入仓库）、类型（本机历史文件 `evidence/miniapp-typecheck.log`，未纳入仓库）、微信构建（本机历史文件 `evidence/miniapp-mp.log`，未纳入仓库）、H5构建（本机历史文件 `evidence/miniapp-h5.log`，未纳入仓库）。
- 原生Chrome实际检查前台和会员选择弹窗，修复H5固定层越出视口，复用原有绿色/金色共享弹窗。最后的H5传送后高度测量改动已通过编译和类型检查，未重跑完整设备尺寸矩阵；用户切换窗口后停止UI操作。这些检查不代表微信真机验收。

为保持回归可重复，本轮新增数据库用例已加入 `apps/api/scripts/core-lifecycle-matrix.json`。其中金额、统计和培训依赖空库的组由runner自动创建并清理专用库，避免上轮夹具污染。复跑使用指向本地 `*_test` 的 `TEST_DATABASE_URL` 执行 `pnpm test:core-lifecycle`；普通门禁执行 `pnpm verify`。本次按组件分别执行各门禁，数据库矩阵没有被省略。

## 发布与历史数据边界

发布需先应用3个新增迁移：

1. `20260912150000_training_contribution_numeric`：培训收入/结算分成numeric检查。
2. `20260912151000_activity_cancellation_refund_obligation`：取消活动下活跃退款的强制义务标记。
3. `20260912153000_avatar_deletion_tasks`：头像删除任务与头像查询索引。

历史已被驳回且没有活跃退款任务的取消订单不会凭空补建资金申请；上线前可执行 只读对账SQL（本机历史文件 `evidence/cancelled-activity-refund-gaps.sql`，未纳入仓库） 核实缺口。本机合成库查询为0不代表生产为0。历史已被旧代码删除的库存分账需从销售/入库证据还原批次和效期，不猜测数据；本轮已阻止新发生的删除。旧版失去引用的头像被访问检查阻断，本轮没有盲目清空上传目录。

保留管理员与前台按既定权限代订过时/已占用场次的能力，保留会员归属、理由、审计与会员本人付款。前台部分退款场地的签到按钮与待签到统计同步按真实预约状态判断，使后端修复可从界面使用。PC只做必要筛选枚举修复。异地备份、外部通知、需额外身份验证的网络安全工作按用户要求跳过。

真实微信登录、支付/退款、分享卡片和真机导航必须在上线候选版本上另做现场验收；本地PG、H5和微信编译结果不能替代。MINI-004原属交互可达性待验证假设，不自动计入32项确认缺陷；最终结论见前端报告。

临时数据库集群已停用，数据目录和专用socket均已删除；只清理本轮创建的5个本地测试库，未触及原有服务。清理记录（本机历史文件 `evidence/cleanup.json`，未纳入仓库）

## 历史附件可用性

2026-09-26 核对：下列原文引用只存在原开发机器，未作为仓库附件交付。保留文件指纹供以后核对；不能把它们当作当前 CI 或真机验收证据。新版本证据使用项目状态页链接的 CI 与发布回执。

| 本机历史相对路径 | 字节 | SHA-256 |
| --- | ---: | --- |
| `../../audits/2026-09-12/WORKLIST.md` | 24759 | `a66303affd0218958ae6beba310fa22e125593d8ce7a298f19d9633aa7dce4c9` |
| `evidence/payment-independent-review.md` | 5428 | `64d66ec533067098b39bdec619c9a67ba8c115d6f238d8be0b8aaa6f9d063826` |
| `backend-game-venue-report.md` | 6733 | `5b0d8de849ef0d256adfee3e3921755437cb43ad2e3af0a3fb9d810ceb370db2` |
| `training-inventory-report.md` | 7631 | `4f5c5922ec53b398aa3fd6dae69f306f6c23ba1683f8fe0f295f89b0295d9591` |
| `privacy-pc-report.md` | 3905 | `5b13d603c24e82adc3613e7aad1c4bc72ed41f93c81f4e37a620d35cd64cc1a0` |
| `evidence/api-unit-final.log` | 1036 | `0298b5f9d7021ec6c7325b4a11b2242f1de1f2a54154513d210cbbcf9deea5d8` |
| `evidence/core-lifecycle-final.log` | 75072 | `e3b889f5d7af033ffd36a35e34bb2dc3c3a8e8469465490818bb39cf10909ffc` |
| `evidence/privacy-search-final.log` | 7650 | `8c83d31eb8cdc4635c3eec1bcf42ae5c1d951d0ad9e414aee8d8ca11a1e55fa1` |
| `evidence/http-contracts-final.log` | 986 | `ce18830dcdaed468403d83b15b77897d2f5080a63d8a90e37145f9bc8d379671` |
| `evidence/shared-tests-final.log` | 337 | `2120192bddbd07b78fa728aac8fb90aa42a14e4505290c5be01a30a633fc4d51` |
| `evidence/admin-tests-final.log` | 256 | `1da97b1cd29e26b07e839e59a14140e176fe3dfa7eff1cc907a32e79d27b479d` |
| `evidence/ops-regression.log` | 1536 | `612165cfbe160630bd2b2010627ab5c5426b49aab09a65f4c7905362c815a2a7` |
| `evidence/api-build-final.log` | 89 | `8e31bcd8ffbd8610bff25283fbcfd491ce21d2b8b51c806cf6c02689e2c57eda` |
| `evidence/admin-build-final.log` | 391 | `b7f9ae4f2ff62582faef3463b35d3b0e1d5797808b135dc5e16fd7df60436391` |
| `evidence/api-lint-final.log` | 20 | `05416bbee478242e5cdb188c949f0499e6088f929af45991db4c3de1c2e0d3b4` |
| `evidence/schema-diff-final.sql` | 32 | `e69c9f21be2b53770b13ea52bf6c4f304a9fc86b41f1e932729ec2de45574341` |
| `evidence/miniapp-tests.log` | 5045 | `bbd998f75d9644f5cf66bae82332307096612820df1c54cc6d89e52bbd7e1e2b` |
| `evidence/miniapp-typecheck.log` | 19 | `aacdfedc485449151e8f0cedfb8264a7d15047256a7b3c3a4a9e848e28e7b178` |
| `evidence/miniapp-mp.log` | 1063 | `04f72c19b7ef1cab68bf758fa6418f84aea1a8e28c6d68ce3a68a03c70e14166` |
| `evidence/miniapp-h5.log` | 427 | `948c87c70dae271439976fc80a9f8df5af449c9c1fb884622d210f159d1b66d6` |
| `evidence/cancelled-activity-refund-gaps.sql` | 1636 | `4b9ffb5386a441412cd727e4b1483d187ea8c9be072672202a2f0a7f4deb9dcc` |
| `evidence/cleanup.json` | 515 | `cd21f9aeed7d01537d51ae7b8f1c2c800389e29b241c0d655018b210a8551346` |
