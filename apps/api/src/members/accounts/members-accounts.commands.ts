import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountAdjustmentStatus,
  AccountTxnKind,
  AppRole,
  Prisma,
  UserStatus,
} from '../../generated/prisma/client.js';
import type {
  AccountAdjustmentQueryDto,
  AdjustAccountDto,
  ReviewAccountAdjustmentDto,
} from '../members.dto.js';
import {
  accountTransactionResponse,
  accountAdjustmentResponse,
} from '../shared/members-support.js';
import { assertAnyRole } from '../shared/members-policy.js';

export async function accountTransactions(
  prisma: PrismaService,
  userId: string,
) {
  const transactions = await prisma.accountTransaction.findMany({
    where: { account: { userId } },
    include: {
      account: { select: { type: true } },
      operator: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return transactions.map(accountTransactionResponse);
}

export async function accountAdjustmentRequests(
  prisma: PrismaService,
  query: AccountAdjustmentQueryDto,
  actor: AuthUser,
) {
  assertAnyRole(
    actor,
    [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '无权查看账户调整申请',
  );
  const requests = await prisma.accountAdjustmentRequest.findMany({
    where: query.status ? { status: query.status } : undefined,
    include: {
      account: {
        include: {
          user: { select: { id: true, displayName: true, phone: true } },
        },
      },
      requestedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
      transaction: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return requests.map((request) =>
    accountAdjustmentResponse(request, actor.sub),
  );
}

export async function adjustAccount(
  prisma: PrismaService,
  userId: string,
  dto: AdjustAccountDto,
  actor: AuthUser,
) {
  assertAnyRole(
    actor,
    [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '无权提交账户调整申请',
  );
  if (dto.amount === 0) throw new BadRequestException('调整金额不能为 0');
  const reason = dto.reason.trim();
  if (reason.length < 2)
    throw new BadRequestException('调整原因至少需要2个字符');
  const requestKey = dto.idempotencyKey.trim();
  if (requestKey.length < 8 || requestKey.length > 100) {
    throw new BadRequestException('幂等键长度必须为8-100个字符');
  }
  const account = await prisma.account.findUnique({
    where: { userId_type: { userId, type: dto.accountType } },
  });
  if (!account) throw new NotFoundException('账户不存在');
  const commandHash = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        userId,
        accountType: dto.accountType,
        amount: dto.amount,
        reason,
      }),
    )
    .digest('hex');
  const replay = async () => {
    const existing = await prisma.accountAdjustmentRequest.findUnique({
      where: { requestIdempotencyKey: requestKey },
    });
    if (!existing) return null;
    if (
      existing.requestedById !== actor.sub ||
      existing.accountId !== account.id ||
      existing.commandHash !== commandHash
    ) {
      throw new ConflictException('幂等键已用于不同的账户调整申请');
    }
    return existing;
  };
  const duplicate = await replay();
  if (duplicate)
    return accountAdjustmentResponse({ ...duplicate, account }, actor.sub);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const duplicateInTransaction =
          await tx.accountAdjustmentRequest.findUnique({
            where: { requestIdempotencyKey: requestKey },
          });
        if (duplicateInTransaction) {
          if (
            duplicateInTransaction.requestedById !== actor.sub ||
            duplicateInTransaction.accountId !== account.id ||
            duplicateInTransaction.commandHash !== commandHash
          ) {
            throw new ConflictException('幂等键已用于不同的账户调整申请');
          }
          return duplicateInTransaction;
        }
        await assertAdjustmentOwnerExists(tx, userId);
        const request = await tx.accountAdjustmentRequest.create({
          data: {
            accountId: account.id,
            amount: dto.amount,
            reason,
            requestedById: actor.sub,
            requestIdempotencyKey: requestKey,
            commandHash,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ACCOUNT_ADJUSTMENT_REQUESTED',
            objectType: 'AccountAdjustmentRequest',
            objectId: request.id,
            newValue: {
              accountId: account.id,
              accountType: account.type,
              amount: dto.amount,
            } as never,
            reason,
          },
        });
        return request;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return accountAdjustmentResponse({ ...result, account }, actor.sub);
  } catch (error) {
    const target =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.meta?.target
        : null;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      JSON.stringify(target).includes('requestIdempotencyKey')
    ) {
      const concurrent = await replay();
      if (concurrent)
        return accountAdjustmentResponse({ ...concurrent, account }, actor.sub);
    }
    throw error;
  }
}

export async function approveAccountAdjustment(
  prisma: PrismaService,
  requestId: string,
  dto: ReviewAccountAdjustmentDto,
  actor: AuthUser,
) {
  assertAnyRole(
    actor,
    [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '无权复核账户调整申请',
  );
  const reviewReason = dto.reason.trim();
  if (reviewReason.length < 2)
    throw new BadRequestException('复核原因至少需要2个字符');
  const result = await prisma.$transaction(
    async (tx) => {
      const request = await tx.accountAdjustmentRequest.findUnique({
        where: { id: requestId },
        include: { account: true, transaction: true },
      });
      if (!request) throw new NotFoundException('账户调整申请不存在');
      if (request.status === AccountAdjustmentStatus.POSTED) return request;
      if (request.status === AccountAdjustmentStatus.REJECTED) {
        throw new ConflictException('已驳回的账户调整不能入账');
      }
      if (request.requestedById === actor.sub) {
        throw new ForbiddenException('账户调整申请人与复核人不能是同一账号');
      }
      await assertAdjustmentOwnerExists(tx, request.account.userId);
      const balanceAfter = request.account.balance + request.amount;
      if (balanceAfter < 0) throw new BadRequestException('账户余额不足');
      const changed = await tx.account.updateMany({
        where: { id: request.account.id, version: request.account.version },
        data: { balance: balanceAfter, version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException('账户已被其他操作更新，请重试');
      const transaction = await tx.accountTransaction.create({
        data: {
          accountId: request.account.id,
          kind:
            request.amount > 0 ? AccountTxnKind.CREDIT : AccountTxnKind.DEBIT,
          amount: request.amount,
          balanceBefore: request.account.balance,
          balanceAfter,
          reasonCode: 'MANUAL_ADJUSTMENT',
          reason: request.reason,
          operatorId: actor.sub,
          idempotencyKey: `ACCOUNT_ADJUSTMENT:${request.id}`,
          metadata: { requestId: request.id, reviewReason },
        },
      });
      const posted = await tx.accountAdjustmentRequest.update({
        where: { id: request.id },
        data: {
          status: AccountAdjustmentStatus.POSTED,
          reviewedById: actor.sub,
          reviewedAt: new Date(),
          reviewReason,
          transactionId: transaction.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'ACCOUNT_ADJUSTMENT_POSTED',
          objectType: 'AccountAdjustmentRequest',
          objectId: request.id,
          oldValue: {
            status: request.status,
            balance: request.account.balance,
          } as never,
          newValue: {
            status: posted.status,
            balance: balanceAfter,
            delta: request.amount,
            transactionId: transaction.id,
          } as never,
          reason: reviewReason,
        },
      });
      return { ...posted, transaction };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return accountAdjustmentResponse(result, actor.sub);
}

export async function assertAdjustmentOwnerExists(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  // Disabled accounts may still need financial closeout; erased accounts may not.
  const owner = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
  if (!owner || owner.status === UserStatus.DELETED || owner.deletedAt) {
    throw new ConflictException('账号已注销或不存在，不能提交或批准账户调整');
  }
}

export async function rejectAccountAdjustment(
  prisma: PrismaService,
  requestId: string,
  dto: ReviewAccountAdjustmentDto,
  actor: AuthUser,
) {
  assertAnyRole(
    actor,
    [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '无权复核账户调整申请',
  );
  const reviewReason = dto.reason.trim();
  if (reviewReason.length < 2)
    throw new BadRequestException('驳回原因至少需要2个字符');
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.accountAdjustmentRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('账户调整申请不存在');
    if (request.status === AccountAdjustmentStatus.REJECTED) return request;
    if (request.status === AccountAdjustmentStatus.POSTED) {
      throw new ConflictException(
        '已入账的账户调整不能驳回；请提交反向调整申请',
      );
    }
    if (request.requestedById === actor.sub) {
      throw new ForbiddenException('账户调整申请人与复核人不能是同一账号');
    }
    const rejected = await tx.accountAdjustmentRequest.update({
      where: { id: request.id },
      data: {
        status: AccountAdjustmentStatus.REJECTED,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
        reviewReason,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'ACCOUNT_ADJUSTMENT_REJECTED',
        objectType: 'AccountAdjustmentRequest',
        objectId: request.id,
        oldValue: { status: request.status } as never,
        newValue: { status: rejected.status } as never,
        reason: reviewReason,
      },
    });
    return rejected;
  });
  return accountAdjustmentResponse(result, actor.sub);
}
