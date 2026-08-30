import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  InventoryTxnType,
  Prisma,
} from '../generated/prisma/client.js';
import type {
  CreateInventoryItemDto,
  InventoryTransactionDto,
} from './inventory.dto.js';
import { applyInventoryDelta } from './inventory-balance.js';

const IN_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.PURCHASE_IN,
  InventoryTxnType.CONSIGNMENT_IN,
]);
const OUT_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.SALE_OUT,
  InventoryTxnType.TRAINING_USAGE,
  InventoryTxnType.EVENT_USAGE,
  InventoryTxnType.RETURN_OUT,
]);
const DOCUMENT_CONTROLLED_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.PURCHASE_IN,
  InventoryTxnType.CONSIGNMENT_IN,
  InventoryTxnType.TRANSFER_OUT,
  InventoryTxnType.TRANSFER_IN,
  InventoryTxnType.LOSS_OUT,
  InventoryTxnType.STOCKTAKE_GAIN,
  InventoryTxnType.STOCKTAKE_LOSS,
  InventoryTxnType.ADJUSTMENT,
  InventoryTxnType.RETURN_OUT,
  InventoryTxnType.STOCKTAKE,
]);

const ADMIN_ROLES: readonly AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN];

const hasRole = (actor: AuthUser, roles: readonly AppRole[]) =>
  actor.roles.some((role) => roles.includes(role));

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.inventoryItem.findMany({
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
      orderBy: [{ enabled: 'desc' }, { stock: 'asc' }],
    });
  }

  lowStock() {
    return this.prisma.$queryRaw<
      {
        id: string;
        sku: string;
        name: string;
        stock: number;
        safeStock: number;
      }[]
    >`SELECT id, sku, name, stock, "safeStock" FROM "InventoryItem" WHERE enabled = true AND stock <= "safeStock" ORDER BY stock ASC`;
  }

  create(dto: CreateInventoryItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const main = await tx.inventoryLocation.findUnique({
        where: { code: 'MAIN' },
      });
      if (!main?.enabled) throw new ConflictException('主仓库位未配置或已停用');
      const item = await tx.inventoryItem.create({
        data: { ...dto, defaultLocationId: main.id },
      });
      await tx.inventoryStockBalance.create({
        data: {
          itemId: item.id,
          locationId: main.id,
          batchCode: 'DEFAULT',
          quantity: item.stock,
        },
      });
      return item;
    });
  }

  async transact(
    itemId: string,
    dto: InventoryTransactionDto,
    actor: AuthUser,
  ) {
    const allowedRoles: readonly AppRole[] =
      dto.type === InventoryTxnType.TRAINING_USAGE
        ? [AppRole.COACH, ...ADMIN_ROLES]
        : dto.type === InventoryTxnType.EVENT_USAGE
          ? [AppRole.EVENT_MANAGER, ...ADMIN_ROLES]
          : dto.type === InventoryTxnType.SALE_OUT
            ? [AppRole.FRONT_DESK, ...ADMIN_ROLES]
            : [AppRole.FRONT_DESK, ...ADMIN_ROLES];
    if (!hasRole(actor, allowedRoles)) {
      throw new ForbiddenException('当前角色无权执行该库存动作');
    }
    if (dto.quantity === 0)
      throw new BadRequestException('库存变动数量不能为 0');
    if (IN_TYPES.has(dto.type) && dto.quantity < 0)
      throw new BadRequestException('入库数量必须为正数');
    if (OUT_TYPES.has(dto.type) && dto.quantity > 0)
      throw new BadRequestException('出库数量必须为负数');
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('库存变动原因不能为空');
    if (
      (dto.type === InventoryTxnType.TRAINING_USAGE ||
        dto.type === InventoryTxnType.EVENT_USAGE) &&
      (!dto.referenceId || !dto.referenceType)
    ) {
      throw new BadRequestException('培训或赛事领用必须关联业务单据');
    }
    const existing = await this.prisma.inventoryTransaction.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      this.assertIdempotentReplay(existing, itemId, dto, actor);
      return existing;
    }
    // Legacy committed rows remain replayable, but new controlled movements
    // must originate from their business document workflow.
    if (DOCUMENT_CONTROLLED_TYPES.has(dto.type)) {
      throw new ConflictException(
        '该库存动作必须通过采购、盘点、调拨或报损单据执行',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Re-check inside the transaction so a retry that raced the
          // preflight lookup returns the original immutable ledger row.
          const duplicateInTransaction =
            await tx.inventoryTransaction.findUnique({
              where: { idempotencyKey: dto.idempotencyKey },
            });
          if (duplicateInTransaction) {
            this.assertIdempotentReplay(
              duplicateInTransaction,
              itemId,
              dto,
              actor,
            );
            return duplicateInTransaction;
          }
          const item = await tx.inventoryItem.findUnique({
            where: { id: itemId },
          });
          if (!item) throw new NotFoundException('库存商品不存在');
          const { stockAfter } = await applyInventoryDelta(
            tx,
            item,
            dto.quantity,
          );
          const transaction = await tx.inventoryTransaction.create({
            data: {
              itemId,
              type: dto.type,
              quantity: dto.quantity,
              stockBefore: item.stock,
              stockAfter,
              unitCostCents: dto.unitCostCents,
              orderItemId: dto.orderItemId,
              operatorId: actor.sub,
              reason,
              metadata: {
                ...dto.metadata,
                ...(dto.referenceId ? { referenceId: dto.referenceId } : {}),
                ...(dto.referenceType
                  ? { referenceType: dto.referenceType }
                  : {}),
              },
              idempotencyKey: dto.idempotencyKey,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'INVENTORY_CHANGED',
              objectType: 'InventoryItem',
              objectId: itemId,
              oldValue: { stock: item.stock } as never,
              newValue: {
                stock: stockAfter,
                type: dto.type,
                quantity: dto.quantity,
              } as never,
              reason,
            },
          });
          return transaction;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Two identical requests can both pass the outer preflight before one
      // commits its unique idempotency row.  Resolve that unique-key race to
      // the committed row instead of leaking a 500/P2002 to the mini-app.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.inventoryTransaction.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (duplicate) {
          this.assertIdempotentReplay(duplicate, itemId, dto, actor);
          return duplicate;
        }
      }
      throw error;
    }
  }

  /**
   * An idempotency key is an immutable command identity, not a convenient
   * lookup alias.  Reusing it with a different item/quantity/type would
   * otherwise silently return the first ledger row and hide a client bug (or
   * a replay attack).  Validate the command shape on every replay path.
   */
  private assertIdempotentReplay(
    existing: {
      itemId?: string;
      type?: InventoryTxnType;
      quantity?: number;
      reason?: string;
      operatorId?: string;
    },
    itemId: string,
    dto: InventoryTransactionDto,
    actor: AuthUser,
  ): void {
    // Unit-test doubles and rows created before the ledger fields were
    // introduced may omit some properties.  Treat an omitted property as an
    // unknown value, but never accept a known conflicting value.
    if (
      (existing.itemId !== undefined && existing.itemId !== itemId) ||
      (existing.type !== undefined && existing.type !== dto.type) ||
      (existing.quantity !== undefined && existing.quantity !== dto.quantity) ||
      (existing.reason !== undefined && existing.reason !== dto.reason.trim())
    ) {
      throw new ConflictException('幂等键已用于其他库存指令，请更换幂等键');
    }
    // The same command may be retried by a different authorized operator
    // after a timeout; that is safe and should remain idempotent.  We only
    // validate immutable business fields above, not the actor identity.
    void actor;
  }
}
