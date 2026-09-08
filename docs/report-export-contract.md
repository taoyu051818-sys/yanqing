# 报表导出契约

导出接口为 `GET /reports/exports/:scope.xlsx`，仅 `FINANCE`、`ADMIN`、`SUPER_ADMIN` 可用。控制器角色守卫之外，服务层会再次校验角色；每次成功导出都会写入 `DATA_EXPORTED` 审计日志，包含导出范围、时间、各工作表行数和单表行数上限。

## 范围与工作表

| scope | 工作表 |
| --- | --- |
| `orders` | Orders、OrderItems、Payments、Refunds |
| `members` | Members、Accounts、AccountTransactions |
| `training` | TrainingEnrollments、TrainingSessions、TrainingAttendances、TrainingRevenue、TrainingSettlements |
| `events` | Orders、OrderItems、Payments、Refunds、Events、EventTeams、EventMatches、EventPrizeAwards |
| `alliance` | Merchants、CouponTemplates、CouponCodes、AllianceSettlements |
| `inventory` | 商品 Orders/OrderItems/Payments/Refunds、Suppliers、InventoryLocations、InventoryItems、InventoryStockBalances、InventoryTransactions、PurchaseOrders/Lines/Receipts/ReceiptLines、Stocktakes/Lines、InventoryOperations、ConsignmentPayableEntries、ConsignmentSettlements/Lines/Transitions |
| `audit` | AuditLogs、ReconciliationPeriods |
| `finance` | Payments、Refunds、AccountTransactions、TrainingRevenue、TrainingSettlements、AllianceSettlements、ConsignmentPayableEntries、ConsignmentSettlements/Lines/Transitions、ReconciliationPeriods |
| `all` / `migration` | 上述全部业务工作表的去重合集 |

同一导出的全部业务工作表在一次 PostgreSQL RepeatableRead 只读事务中读取，管理员与财务数据路径使用同一事务客户端；读取完成后再生成 Excel 和记录导出审计。ExportManifest 的 consistency 为 REPEATABLE_READ。培训结算包含 settledAt 入账时间。

每个文件第一张表固定为 `ExportManifest`，记录 scope、导出人、导出角色、导出时间、单表行数和是否触及 10,000 行上限。触及上限意味着应按后续批次或专用迁移工具继续提取，不能把该文件认定为完整数据库备份。

## 数据安全和可读性

- 日期统一写成 ISO 8601 字符串。
- JSON、参数快照、结算明细和 Decimal 等对象统一序列化为文本，保留审计字段。
- 以 `=`、`+`、`-`、`@` 开头的字符串会加单引号，避免 Excel 公式注入。
- 会员表采用字段白名单，不导出微信 OpenID 等登录标识；所有名为 phone 的字段统一脱敏。
- 支付表保留支付单号、渠道、金额、状态与第三方交易号，但不导出原始 provider payload。
- 空数据集仍保留工作表和表头，写入“暂无数据”。
- Excel 工作表名受 31 字符限制，`ConsignmentTransitions` 对应数据库 `ConsignmentSettlementTransition`；与应付、结算单、明细行一起可还原寄售对账证据链。

## 当前证据边界

`reports.service.spec.ts` 覆盖角色拒绝、非法范围、多工作表、日期/JSON/公式安全序列化、财务账簿集合、`all`/`migration` 完整集合和审计载荷。该证据证明代码生成和单元测试路径可用，不代表已在真实 PostgreSQL、真实生产数据或微信真机上执行过导出；部署验收仍需在目标测试环境下载文件并逐表抽样核对。

2026-09-08 补充验收：reporting-boundaries.integration.spec.ts 使用真实 PostgreSQL、会员订单和余额支付，控制付款发生在订单表与付款表查询之间，验证管理员/财务导出均不会混合付款前后状态；实际生成并解码 XLSX。
