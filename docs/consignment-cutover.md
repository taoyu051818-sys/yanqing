# 寄售应付快照 cutover 审计

## 边界定义

`20260830200000_consignment_settlements` 只建立应付与结算账本，不代表历史经济规则可以被自动还原。正式 cutover 应记录为：**首个写入 `OrderItem.metadata.inventorySnapshotVersion = 1` 的应用版本实际部署时间**。

版本 1 会在下单时冻结 SKU 模式、供应商 ID/代码/名称，以及结算周期和场馆佣金基点。支付履约只读取该订单快照；之后修改商品模式、绑定供应商或佣金规则，不得改变订单应付。

cutover 前的寄售订单只有 SKU、模式和供应商名称，没有当时的供应商 ID、结算规则版本或佣金基点。当前主数据不能证明历史合同事实，因此禁止用当前规则批量回填。

## 上线前审计查询

在生产库只读执行并导出结果，结果文件需记录查询时间、应用版本、行数、SHA-256 和财务/管理员双人签字：

```sql
SELECT
  o.id AS order_id,
  o."orderNo" AS order_no,
  o.status AS order_status,
  o."createdAt" AS order_created_at,
  o."completedAt" AS order_completed_at,
  oi.id AS order_item_id,
  oi."itemId" AS inventory_item_id,
  oi.name AS item_name,
  oi.quantity,
  oi."amountCents" AS amount_cents,
  oi.metadata,
  COUNT(cpe.id) AS payable_entry_count
FROM "Order" o
JOIN "OrderItem" oi ON oi."orderId" = o.id
LEFT JOIN "ConsignmentPayableEntry" cpe ON cpe."orderItemId" = oi.id
WHERE o."businessType" = 'GOODS'
  AND oi.metadata ->> 'mode' = 'CONSIGNMENT'
  AND COALESCE(oi.metadata ->> 'inventorySnapshotVersion', '') <> '1'
GROUP BY o.id, oi.id
ORDER BY o."createdAt", o.id, oi.id;
```

## 处置规则

- `PENDING` 且尚未付款：取消旧订单并从当前有效商品重新下单，生成完整版本 1 快照后再支付。
- 已完成且已有应付：保留不可变账本，逐笔核对原合同、订单金额和已生成规则快照，不重算原行。
- 已完成但没有应付：进入独立的财务 cutover 差异清册。取得原合同、结算单或供应商确认后，再走经批准的数据修复方案；当前系统不允许用现行佣金规则猜测历史金额，也不允许直接修改原销售证据。
- 无法取得历史合同证据：保持异常未决并披露影响金额，不得为了“清零”而补造应付。

上线验收必须确认审计查询已归档、所有未决项有负责人和处理结论，并在应用部署记录中保存准确 cutover 时间。
