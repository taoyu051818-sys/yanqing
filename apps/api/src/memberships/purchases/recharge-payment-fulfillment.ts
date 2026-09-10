import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictException } from '@nestjs/common';
import {
  AccountTxnKind,
  AccountType,
  BusinessType,
} from '../../generated/prisma/client.js';
import type { PaidOrderContext } from '../../orders/paid-order-context.js';

type RechargePaymentContext = Pick<PaidOrderContext, 'paymentActorId'> & {
  readonly tx: {
    account: Pick<
      Prisma.TransactionClient['account'],
      'findUniqueOrThrow' | 'updateMany'
    >;
    accountTransaction: Pick<
      Prisma.TransactionClient['accountTransaction'],
      'findUnique' | 'create'
    >;
  };
  readonly order: Pick<
    PaidOrderContext['order'],
    'id' | 'businessType' | 'parameterSnapshot' | 'memberId' | 'title'
  >;
  readonly payment: Pick<PaidOrderContext['payment'], 'id'>;
};

export async function creditPaidRecharge({
  tx,
  order,
  payment,
  paymentActorId,
}: RechargePaymentContext): Promise<void> {
  if (order.businessType === BusinessType.RECHARGE) {
    const snapshot = order.parameterSnapshot as {
      principalCents?: number;
      giftCents?: number;
    };
    const credits: Array<[AccountType, number]> = [
      [
        AccountType.CASH_PRINCIPAL,
        Math.max(0, Number(snapshot.principalCents) || 0),
      ],
      [AccountType.GIFT_BALANCE, Math.max(0, Number(snapshot.giftCents) || 0)],
    ];
    for (const [type, amount] of credits) {
      if (!amount) continue;
      const account = await tx.account.findUniqueOrThrow({
        where: { userId_type: { userId: order.memberId, type } },
      });
      const idempotencyKey = `RECHARGE:${payment.id}:${type}`;
      const existing = await tx.accountTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) continue;
      const changedAccount = await tx.account.updateMany({
        where: { id: account.id, version: account.version },
        data: { balance: { increment: amount }, version: { increment: 1 } },
      });
      if (changedAccount.count !== 1)
        throw new ConflictException('账户余额已变化，请重试支付回调');
      await tx.accountTransaction.create({
        data: {
          accountId: account.id,
          kind: AccountTxnKind.CREDIT,
          amount,
          balanceBefore: account.balance,
          balanceAfter: account.balance + amount,
          reasonCode: 'MEMBER_RECHARGE',
          reason: order.title,
          orderId: order.id,
          operatorId: paymentActorId,
          idempotencyKey,
        },
      });
    }
  }
}
