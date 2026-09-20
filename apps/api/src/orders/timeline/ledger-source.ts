import { Prisma } from '../../generated/prisma/client.js';

// External receipts and wallet movements are different scopes. A payment that
// later became REFUNDED still belongs in the original receipt history.
export const externalLedger = Prisma.sql`
 SELECT 'payment:' || p.id AS id, p."paidAt" AS at, p."orderId", p."userId" AS "memberId",
   p."operatorId", p."channel"::text AS channel, p."amountCents"::bigint AS amount,
   'CNY'::text AS unit, '收款'::text AS reason, 'SUCCEEDED'::text AS status
 FROM "Payment" p WHERE p.status IN ('SUCCEEDED','REFUNDED') AND p."paidAt" IS NOT NULL
   AND p.channel IN ('WECHAT','OFFLINE_CASH')
 UNION ALL
 SELECT 'refund:' || r.id, r."completedAt", r."orderId", o."memberId", r."approvedById",
   o."paymentChannel"::text, -r."amountCents"::bigint, 'CNY', '退款', 'SUCCEEDED'
 FROM "Refund" r JOIN "Order" o ON o.id = r."orderId"
 WHERE r.status = 'SUCCEEDED' AND r."completedAt" IS NOT NULL AND o."paymentChannel" IN ('WECHAT','OFFLINE_CASH')`;
export const accountLedger = Prisma.sql`
 SELECT 'account:' || t.id AS id, t."createdAt" AS at, t."orderId", a."userId" AS "memberId",
   t."operatorId", a.type::text AS channel, t.amount::bigint AS amount,
   CASE WHEN a.type IN ('CASH_PRINCIPAL','GIFT_BALANCE') THEN 'CNY'
        WHEN a.type = 'BADMINTON_COIN' THEN 'COIN' ELSE 'POINT' END AS unit,
   t.reason, t.kind::text AS status
 FROM "AccountTransaction" t JOIN "Account" a ON a.id = t."accountId"`;
