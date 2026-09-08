import { ConflictException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** Do not retry a review against a new application or silently reuse stale reads. */
export async function stateTransition<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    const failure = error as {
      code?: string;
      meta?: {
        code?: string;
        driverAdapterError?: { cause?: { originalCode?: string } };
      };
    } | null;
    const sqlState =
      failure?.meta?.code ??
      failure?.meta?.driverAdapterError?.cause?.originalCode;
    if (
      failure &&
      (['P2034', 'P2002', 'P2025'].includes(failure.code ?? '') ||
        (failure.code === 'P2010' &&
          ['40001', '40P01'].includes(sqlState ?? '')))
    ) {
      throw new ConflictException('状态已被其他操作修改，请刷新后重试');
    }
    throw error;
  }
}

/**
 * A refund request changes only Order. Lock it before changing admission so
 * ReadCommitted refund writers cannot commit between our check and admission.
 * Under Serializable, an order changed since our snapshot aborts this command.
 */
export async function lockAdmissionOrder(
  tx: Prisma.TransactionClient,
  orderId: string | null | undefined,
) {
  if (orderId) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR NO KEY UPDATE`;
  }
}
