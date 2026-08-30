import { randomBytes } from 'node:crypto';

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
  BusinessType,
  ConsignmentPayableEntryType,
  ConsignmentSettlementAction,
  InventoryTxnType,
  Prisma,
  RefundStatus,
  SettlementStatus,
  SupplierType,
} from '../generated/prisma/client.js';
import {
  ConsignmentPayableQueryDto,
  ConsignmentSettlementActionDto,
  ConsignmentSettlementQueryDto,
  CreateConsignmentSettlementDto,
  SettleConsignmentSettlementDto,
} from './consignment-settlement.dto.js';
import { inventoryCommandHash } from './inventory-master-data.js';
import {
  ConsignmentOrderSnapshotError,
  readConsignmentOrderSnapshot,
} from './consignment-order-snapshot.js';

const SETTLEMENT_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

const statementNo = () =>
  `CS${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class ConsignmentSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one payable ledger entry for each consignment line in a completed
   * goods order.  Callers must invoke this inside the same transaction and
   * after SALE_OUT plus order fulfilment have succeeded.
   */
  async recordCompletedGoodsSale(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    actorRole: AppRole,
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            inventoryTransactions: {
              where: { type: InventoryTxnType.SALE_OUT },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('商品订单不存在');
    if (order.businessType !== BusinessType.GOODS)
      throw new ConflictException('仅商品订单可生成寄售应付');
    if (!order.completedAt)
      throw new ConflictException('商品订单尚未完成履约，不能生成寄售应付');

    const created = [];

    for (const orderItem of order.items) {
      if (!orderItem.itemId) continue;
      let orderSnapshot: ReturnType<typeof readConsignmentOrderSnapshot>;
      try {
        orderSnapshot = readConsignmentOrderSnapshot(orderItem.metadata);
      } catch (error) {
        if (error instanceof ConsignmentOrderSnapshotError)
          throw new ConflictException(error.message);
        throw error;
      }
      if (!orderSnapshot) continue;
      if (
        !orderItem.inventoryTransactions.some(
          (entry) => entry.quantity === -orderItem.quantity,
        )
      ) {
        throw new ConflictException(`商品 ${orderItem.name} 尚未完成销售出库`);
      }
      const grossSaleCents = orderItem.unitPriceCents * orderItem.quantity;
      if (grossSaleCents !== orderItem.amountCents)
        throw new ConflictException(
          `商品 ${orderItem.name} 的成交金额快照不一致`,
        );
      if (grossSaleCents <= 0) continue;
      const commissionCents = Math.round(
        (grossSaleCents * orderSnapshot.commissionRateBps) / 10_000,
      );
      const payableCents = grossSaleCents - commissionCents;
      const idempotencyKey = `CONSIGNMENT-SALE:${orderItem.id}`;
      const existing = await tx.consignmentPayableEntry.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (
          existing.orderId !== order.id ||
          existing.orderItemId !== orderItem.id ||
          existing.supplierId !== orderSnapshot.supplierId ||
          existing.payableCents !== payableCents
        ) {
          throw new ConflictException('寄售销售应付幂等记录与当前订单不一致');
        }
        created.push(existing);
        continue;
      }
      const payable = await tx.consignmentPayableEntry.create({
        data: {
          type: ConsignmentPayableEntryType.SALE,
          supplierId: orderSnapshot.supplierId,
          itemId: orderItem.itemId,
          orderId: order.id,
          orderItemId: orderItem.id,
          quantity: orderItem.quantity,
          unitSalePriceCents: orderItem.unitPriceCents,
          grossSaleCents,
          commissionRateBps: orderSnapshot.commissionRateBps,
          commissionCents,
          payableCents,
          ruleSnapshot: {
            supplierCode: orderSnapshot.supplierCode,
            supplierName: orderSnapshot.supplierName,
            sku: orderSnapshot.sku,
            itemName: orderItem.name,
            settlementCycle: orderSnapshot.settlementCycle,
            commissionRateBps: orderSnapshot.commissionRateBps,
            commissionMeaning: 'VENUE_COMMISSION',
          },
          occurredAt: order.completedAt,
          idempotencyKey,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          actorRole,
          action: 'CONSIGNMENT_PAYABLE_SALE_RECORDED',
          objectType: 'ConsignmentPayableEntry',
          objectId: payable.id,
          reason: `商品订单 ${order.orderNo} 完成履约`,
          newValue: {
            supplierId: orderSnapshot.supplierId,
            itemId: orderItem.itemId,
            orderId: order.id,
            orderItemId: orderItem.id,
            quantity: orderItem.quantity,
            grossSaleCents,
            commissionCents,
            payableCents,
          } as never,
          requestId: idempotencyKey,
        },
      });
      created.push(payable);
    }
    return created;
  }

  /**
   * Reverses the exact original supplier payable after a successful whole
   * goods refund.  The original SALE row remains immutable and traceable.
   */
  async recordSucceededGoodsRefund(
    tx: Prisma.TransactionClient,
    refundId: string,
    actorId: string,
    actorRole: AppRole,
  ) {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: { order: true },
    });
    if (!refund) throw new NotFoundException('商品退款不存在');
    if (
      refund.status !== RefundStatus.SUCCEEDED ||
      !refund.completedAt ||
      refund.order.businessType !== BusinessType.GOODS
    ) {
      throw new ConflictException('仅成功的商品退款可反冲寄售应付');
    }
    if (refund.order.refundedCents < refund.order.paidCents)
      throw new ConflictException('商品订单尚未整单退款，不能反冲寄售应付');

    const sales = await tx.consignmentPayableEntry.findMany({
      where: {
        orderId: refund.orderId,
        type: ConsignmentPayableEntryType.SALE,
      },
      include: { reversedBy: true },
      orderBy: { createdAt: 'asc' },
    });
    const reversals = [];
    for (const sale of sales) {
      if (sale.reversedBy) {
        if (sale.reversedBy.refundId !== refund.id)
          throw new ConflictException('寄售应付已由其他退款记录反冲');
        reversals.push(sale.reversedBy);
        continue;
      }
      const idempotencyKey = `CONSIGNMENT-REFUND:${refund.id}:${sale.id}`;
      const reversal = await tx.consignmentPayableEntry.create({
        data: {
          type: ConsignmentPayableEntryType.REFUND_REVERSAL,
          supplierId: sale.supplierId,
          itemId: sale.itemId,
          orderId: sale.orderId,
          orderItemId: sale.orderItemId,
          refundId: refund.id,
          reversalOfId: sale.id,
          quantity: -sale.quantity,
          unitSalePriceCents: sale.unitSalePriceCents,
          grossSaleCents: -sale.grossSaleCents,
          commissionRateBps: sale.commissionRateBps,
          commissionCents: -sale.commissionCents,
          payableCents: -sale.payableCents,
          ruleSnapshot: {
            ...asRecord(sale.ruleSnapshot),
            reversalOfEntryId: sale.id,
            refundNo: refund.refundNo,
          },
          occurredAt: refund.completedAt,
          idempotencyKey,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          actorRole,
          action: 'CONSIGNMENT_PAYABLE_REFUND_REVERSED',
          objectType: 'ConsignmentPayableEntry',
          objectId: reversal.id,
          reason: refund.reason,
          oldValue: {
            saleEntryId: sale.id,
            payableCents: sale.payableCents,
          } as never,
          newValue: {
            refundId: refund.id,
            reversalOfId: sale.id,
            payableCents: -sale.payableCents,
          } as never,
          requestId: idempotencyKey,
        },
      });
      reversals.push(reversal);
    }
    return reversals;
  }

  async listPayables(query: ConsignmentPayableQueryDto, actor: AuthUser) {
    this.assertSettlementRole(actor);
    const period = this.optionalPeriod(query.periodStart, query.periodEnd);
    const where: Prisma.ConsignmentPayableEntryWhereInput = {
      supplierId: query.supplierId,
      type: query.type,
      ...(period
        ? { occurredAt: { gte: period.periodStart, lt: period.periodEnd } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.consignmentPayableEntry.findMany({
        where,
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          item: { select: { id: true, sku: true, name: true } },
          order: { select: { id: true, orderNo: true, completedAt: true } },
          refund: { select: { id: true, refundNo: true, completedAt: true } },
          settlementLines: {
            include: {
              settlement: {
                select: { id: true, statementNo: true, status: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.consignmentPayableEntry.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listSettlements(query: ConsignmentSettlementQueryDto, actor: AuthUser) {
    this.assertSettlementRole(actor);
    const period = this.optionalPeriod(query.periodStart, query.periodEnd);
    const where: Prisma.ConsignmentSettlementWhereInput = {
      supplierId: query.supplierId,
      status: query.status,
      ...(period
        ? {
            periodStart: { gte: period.periodStart },
            periodEnd: { lte: period.periodEnd },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.consignmentSettlement.findMany({
        where,
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, displayName: true } },
          confirmedBy: { select: { id: true, displayName: true } },
          settledBy: { select: { id: true, displayName: true } },
          transitions: {
            include: { actor: { select: { id: true, displayName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: [{ periodEnd: 'desc' }, { version: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.consignmentSettlement.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string, actor: AuthUser) {
    this.assertSettlementRole(actor);
    return this.prisma.$transaction((tx) => this.loadSettlementDetail(tx, id));
  }

  async createSettlement(dto: CreateConsignmentSettlementDto, actor: AuthUser) {
    this.assertSettlementRole(actor);
    const period = this.requiredPeriod(dto.periodStart, dto.periodEnd);
    const command = this.normalizeCommand(dto.reason, dto.idempotencyKey);
    const commandHash = inventoryCommandHash({
      action: ConsignmentSettlementAction.CREATED,
      supplierId: dto.supplierId,
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      reason: command.reason,
    });
    const replay = await this.prisma.consignmentSettlement.findUnique({
      where: { creationIdempotencyKey: command.idempotencyKey },
    });
    if (replay) {
      this.assertCreationReplay(replay, actor, commandHash);
      return this.detail(replay.id, actor);
    }

    try {
      const id = await this.prisma.$transaction(
        async (tx) => {
          const supplier = await tx.supplier.findUnique({
            where: { id: dto.supplierId },
          });
          if (!supplier) throw new NotFoundException('寄售供应商不存在');
          if (supplier.type !== SupplierType.CONSIGNMENT)
            throw new ConflictException('自营采购供应商不能生成寄售结算单');
          const rule = this.requireConsignmentRule(supplier.settlementRule);
          const active = await tx.consignmentSettlement.findFirst({
            where: {
              supplierId: supplier.id,
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              status: { not: SettlementStatus.VOID },
            },
          });
          if (active)
            throw new ConflictException('该供应商账期已有未作废结算单');

          const entries = await tx.consignmentPayableEntry.findMany({
            where: {
              supplierId: supplier.id,
              occurredAt: { gte: period.periodStart, lt: period.periodEnd },
              settlementLines: { none: { releasedAt: null } },
            },
            orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
            take: 10_001,
          });
          if (!entries.length)
            throw new BadRequestException('该供应商账期没有待结寄售应付明细');
          if (entries.length > 10_000)
            throw new BadRequestException(
              '单张结算单最多包含10000条明细，请拆分账期',
            );

          const latest = await tx.consignmentSettlement.findFirst({
            where: {
              supplierId: supplier.id,
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
            },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          const totals = this.entryTotals(entries);
          const settlement = await tx.consignmentSettlement.create({
            data: {
              statementNo: statementNo(),
              supplierId: supplier.id,
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              version: (latest?.version ?? 0) + 1,
              status: SettlementStatus.DRAFT,
              ...totals,
              ruleSnapshot: {
                supplierCode: supplier.code,
                supplierName: supplier.name,
                settlementCycle: rule.settlementCycle,
                commissionRateBps: rule.commissionRateBps,
                commissionMeaning: 'VENUE_COMMISSION',
              },
              creationReason: command.reason,
              creationIdempotencyKey: command.idempotencyKey,
              creationCommandHash: commandHash,
              createdById: actor.sub,
              lines: {
                create: entries.map((entry) => ({
                  payableEntryId: entry.id,
                  quantity: entry.quantity,
                  grossSaleCents: entry.grossSaleCents,
                  commissionCents: entry.commissionCents,
                  payableCents: entry.payableCents,
                })),
              },
              transitions: {
                create: {
                  action: ConsignmentSettlementAction.CREATED,
                  fromStatus: null,
                  toStatus: SettlementStatus.DRAFT,
                  reason: command.reason,
                  actorId: actor.sub,
                  idempotencyKey: command.idempotencyKey,
                  commandHash,
                },
              },
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'CONSIGNMENT_SETTLEMENT_CREATED',
              objectType: 'ConsignmentSettlement',
              objectId: settlement.id,
              reason: command.reason,
              requestId: command.idempotencyKey,
              newValue: {
                commandHash,
                supplierId: supplier.id,
                periodStart: period.periodStart.toISOString(),
                periodEnd: period.periodEnd.toISOString(),
                version: settlement.version,
                ...totals,
              } as never,
            },
          });
          return settlement.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.detail(id, actor);
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const duplicate = await this.prisma.consignmentSettlement.findUnique({
          where: { creationIdempotencyKey: command.idempotencyKey },
        });
        if (duplicate) {
          this.assertCreationReplay(duplicate, actor, commandHash);
          return this.detail(duplicate.id, actor);
        }
        throw new ConflictException(
          '寄售结算单被其他操作并发生成，请刷新后重试',
        );
      }
      throw error;
    }
  }

  submitSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionSettlement(
      id,
      dto,
      actor,
      ConsignmentSettlementAction.SUBMITTED,
    );
  }

  confirmSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionSettlement(
      id,
      dto,
      actor,
      ConsignmentSettlementAction.CONFIRMED,
    );
  }

  disputeSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionSettlement(
      id,
      dto,
      actor,
      ConsignmentSettlementAction.DISPUTED,
    );
  }

  returnSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionSettlement(
      id,
      dto,
      actor,
      ConsignmentSettlementAction.RETURNED,
    );
  }

  settleSettlement(
    id: string,
    dto: SettleConsignmentSettlementDto,
    actor: AuthUser,
  ) {
    return this.transitionSettlement(
      id,
      dto,
      actor,
      ConsignmentSettlementAction.SETTLED,
    );
  }

  voidSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionSettlement(
      id,
      dto,
      actor,
      ConsignmentSettlementAction.VOIDED,
    );
  }

  private async transitionSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto | SettleConsignmentSettlementDto,
    actor: AuthUser,
    action: ConsignmentSettlementAction,
  ) {
    this.assertSettlementRole(actor);
    const command = this.normalizeCommand(dto.reason, dto.idempotencyKey);
    const paymentReference =
      action === ConsignmentSettlementAction.SETTLED
        ? (dto as SettleConsignmentSettlementDto).paymentReference?.trim()
        : undefined;
    if (
      action === ConsignmentSettlementAction.SETTLED &&
      (!paymentReference ||
        paymentReference.length < 2 ||
        paymentReference.length > 120)
    ) {
      throw new BadRequestException('结算付款凭证长度必须为2-120个字符');
    }
    const transition = this.transitionDefinition(action);
    const commandHash = inventoryCommandHash({
      action,
      settlementId: id,
      fromStatus: transition.from,
      toStatus: transition.to,
      reason: command.reason,
      paymentReference,
    });

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const replay = await tx.consignmentSettlementTransition.findUnique({
            where: { idempotencyKey: command.idempotencyKey },
          });
          if (replay) {
            this.assertTransitionReplay(replay, id, actor, action, commandHash);
            return;
          }
          const current = await tx.consignmentSettlement.findUnique({
            where: { id },
          });
          if (!current) throw new NotFoundException('寄售结算单不存在');
          if (current.status !== transition.from)
            throw new ConflictException(
              `寄售结算单当前状态为 ${current.status}，不能执行 ${action}`,
            );
          if (
            new Set<ConsignmentSettlementAction>([
              ConsignmentSettlementAction.CONFIRMED,
              ConsignmentSettlementAction.DISPUTED,
              ConsignmentSettlementAction.RETURNED,
              ConsignmentSettlementAction.SETTLED,
            ]).has(action) &&
            current.createdById === actor.sub
          ) {
            throw new ForbiddenException(
              '制单人不能确认、争议、退回或结算自己的寄售结算单',
            );
          }
          if (
            new Set<ConsignmentSettlementAction>([
              ConsignmentSettlementAction.SUBMITTED,
              ConsignmentSettlementAction.CONFIRMED,
              ConsignmentSettlementAction.SETTLED,
            ]).has(action)
          ) {
            await this.assertStatementSnapshotCurrent(tx, current);
          }

          const now = new Date();
          const data = this.transitionData(
            action,
            actor.sub,
            now,
            paymentReference,
          );
          const changed = await tx.consignmentSettlement.updateMany({
            where: { id, status: transition.from },
            data: { status: transition.to, ...data },
          });
          if (changed.count !== 1)
            throw new ConflictException(
              '寄售结算状态已被其他操作更新，请刷新后重试',
            );
          if (action === ConsignmentSettlementAction.VOIDED) {
            await tx.consignmentSettlementLine.updateMany({
              where: { settlementId: id, releasedAt: null },
              data: { releasedAt: now },
            });
          }
          await tx.consignmentSettlementTransition.create({
            data: {
              settlementId: id,
              action,
              fromStatus: transition.from,
              toStatus: transition.to,
              reason: command.reason,
              actorId: actor.sub,
              idempotencyKey: command.idempotencyKey,
              commandHash,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: `CONSIGNMENT_SETTLEMENT_${action}`,
              objectType: 'ConsignmentSettlement',
              objectId: id,
              reason: command.reason,
              requestId: command.idempotencyKey,
              oldValue: { status: transition.from } as never,
              newValue: {
                commandHash,
                status: transition.to,
                paymentReference,
              } as never,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.detail(id, actor);
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const replay =
          await this.prisma.consignmentSettlementTransition.findUnique({
            where: { idempotencyKey: command.idempotencyKey },
          });
        if (replay) {
          this.assertTransitionReplay(replay, id, actor, action, commandHash);
          return this.detail(id, actor);
        }
        throw new ConflictException('寄售结算状态发生并发冲突，请刷新后重试');
      }
      throw error;
    }
  }

  private transitionDefinition(action: ConsignmentSettlementAction) {
    const definitions: Record<
      ConsignmentSettlementAction,
      { from: SettlementStatus; to: SettlementStatus }
    > = {
      [ConsignmentSettlementAction.CREATED]: {
        from: SettlementStatus.DRAFT,
        to: SettlementStatus.DRAFT,
      },
      [ConsignmentSettlementAction.SUBMITTED]: {
        from: SettlementStatus.DRAFT,
        to: SettlementStatus.PENDING_CONFIRMATION,
      },
      [ConsignmentSettlementAction.CONFIRMED]: {
        from: SettlementStatus.PENDING_CONFIRMATION,
        to: SettlementStatus.CONFIRMED,
      },
      [ConsignmentSettlementAction.DISPUTED]: {
        from: SettlementStatus.PENDING_CONFIRMATION,
        to: SettlementStatus.DRAFT,
      },
      [ConsignmentSettlementAction.RETURNED]: {
        from: SettlementStatus.CONFIRMED,
        to: SettlementStatus.DRAFT,
      },
      [ConsignmentSettlementAction.SETTLED]: {
        from: SettlementStatus.CONFIRMED,
        to: SettlementStatus.SETTLED,
      },
      [ConsignmentSettlementAction.VOIDED]: {
        from: SettlementStatus.DRAFT,
        to: SettlementStatus.VOID,
      },
    };
    return definitions[action];
  }

  private transitionData(
    action: ConsignmentSettlementAction,
    actorId: string,
    now: Date,
    paymentReference?: string,
  ): Prisma.ConsignmentSettlementUncheckedUpdateManyInput {
    if (action === ConsignmentSettlementAction.SUBMITTED)
      return { submittedById: actorId, submittedAt: now };
    if (action === ConsignmentSettlementAction.CONFIRMED)
      return { confirmedById: actorId, confirmedAt: now };
    if (
      action === ConsignmentSettlementAction.DISPUTED ||
      action === ConsignmentSettlementAction.RETURNED
    ) {
      return {
        submittedById: null,
        submittedAt: null,
        confirmedById: null,
        confirmedAt: null,
        settledById: null,
        settledAt: null,
        paymentReference: null,
      };
    }
    if (action === ConsignmentSettlementAction.SETTLED)
      return { settledById: actorId, settledAt: now, paymentReference };
    if (action === ConsignmentSettlementAction.VOIDED)
      return { voidedById: actorId, voidedAt: now };
    return {};
  }

  private async assertStatementSnapshotCurrent(
    tx: Prisma.TransactionClient,
    settlement: {
      id: string;
      supplierId: string;
      periodStart: Date;
      periodEnd: Date;
      entryCount: number;
      netQuantity: number;
      grossSaleCents: number;
      commissionCents: number;
      payableCents: number;
    },
  ) {
    const [activeLines, unclaimed] = await Promise.all([
      tx.consignmentSettlementLine.aggregate({
        where: { settlementId: settlement.id, releasedAt: null },
        _count: { _all: true },
        _sum: {
          quantity: true,
          grossSaleCents: true,
          commissionCents: true,
          payableCents: true,
        },
      }),
      tx.consignmentPayableEntry.count({
        where: {
          supplierId: settlement.supplierId,
          occurredAt: { gte: settlement.periodStart, lt: settlement.periodEnd },
          settlementLines: { none: { releasedAt: null } },
        },
      }),
    ]);
    if (
      activeLines._count._all !== settlement.entryCount ||
      (activeLines._sum.quantity ?? 0) !== settlement.netQuantity ||
      (activeLines._sum.grossSaleCents ?? 0) !== settlement.grossSaleCents ||
      (activeLines._sum.commissionCents ?? 0) !== settlement.commissionCents ||
      (activeLines._sum.payableCents ?? 0) !== settlement.payableCents
    ) {
      throw new ConflictException(
        '寄售结算单明细与冻结汇总不一致，请联系管理员',
      );
    }
    if (unclaimed > 0)
      throw new ConflictException(
        '账期新增寄售应付或退款冲正，请作废并重建结算单',
      );
  }

  private entryTotals(
    entries: Array<{
      quantity: number;
      grossSaleCents: number;
      commissionCents: number;
      payableCents: number;
    }>,
  ) {
    return entries.reduce(
      (totals, entry) => ({
        entryCount: totals.entryCount + 1,
        netQuantity: totals.netQuantity + entry.quantity,
        grossSaleCents: totals.grossSaleCents + entry.grossSaleCents,
        commissionCents: totals.commissionCents + entry.commissionCents,
        payableCents: totals.payableCents + entry.payableCents,
      }),
      {
        entryCount: 0,
        netQuantity: 0,
        grossSaleCents: 0,
        commissionCents: 0,
        payableCents: 0,
      },
    );
  }

  private requireConsignmentRule(value: Prisma.JsonValue | null) {
    const rule = asRecord(value);
    const settlementCycle = String(rule.settlementCycle ?? '');
    const commissionRateBps = Number(rule.commissionRateBps);
    if (!['PER_ORDER', 'WEEKLY', 'MONTHLY'].includes(settlementCycle))
      throw new ConflictException('寄售供应商未配置有效结算周期');
    if (
      !Number.isInteger(commissionRateBps) ||
      commissionRateBps < 0 ||
      commissionRateBps > 10_000
    ) {
      throw new ConflictException('寄售供应商未配置有效场馆佣金基点');
    }
    return { settlementCycle, commissionRateBps };
  }

  private normalizeCommand(reasonValue: string, keyValue: string) {
    const reason = reasonValue?.trim();
    const idempotencyKey = keyValue?.trim();
    if (!reason || reason.length < 2 || reason.length > 300)
      throw new BadRequestException('操作原因长度必须为2-300个字符');
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 100
    )
      throw new BadRequestException('幂等键长度必须为8-100个字符');
    return { reason, idempotencyKey };
  }

  private requiredPeriod(startValue: string, endValue: string) {
    const periodStart = new Date(startValue);
    const periodEnd = new Date(endValue);
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd <= periodStart
    ) {
      throw new BadRequestException('寄售结算周期无效');
    }
    if (periodEnd.getTime() - periodStart.getTime() > 366 * 86_400_000)
      throw new BadRequestException('单张寄售结算单周期不能超过366天');
    return { periodStart, periodEnd };
  }

  private optionalPeriod(startValue?: string, endValue?: string) {
    if (!startValue && !endValue) return null;
    if (!startValue || !endValue)
      throw new BadRequestException('查询周期开始和结束时间必须同时填写');
    return this.requiredPeriod(startValue, endValue);
  }

  private assertSettlementRole(actor: AuthUser) {
    if (!actor.roles.some((role) => SETTLEMENT_ROLES.includes(role)))
      throw new ForbiddenException('仅财务或管理员可操作寄售应付与结算');
  }

  private assertCreationReplay(
    settlement: {
      createdById: string;
      creationCommandHash: string;
    },
    actor: AuthUser,
    commandHash: string,
  ) {
    if (
      settlement.createdById !== actor.sub ||
      settlement.creationCommandHash !== commandHash
    ) {
      throw new ConflictException('寄售结算创建幂等键已用于其他操作人或命令');
    }
  }

  private assertTransitionReplay(
    replay: {
      settlementId: string;
      actorId: string;
      action: ConsignmentSettlementAction;
      commandHash: string;
    },
    settlementId: string,
    actor: AuthUser,
    action: ConsignmentSettlementAction,
    commandHash: string,
  ) {
    if (
      replay.settlementId !== settlementId ||
      replay.actorId !== actor.sub ||
      replay.action !== action ||
      replay.commandHash !== commandHash
    ) {
      throw new ConflictException('寄售结算动作幂等键已用于其他操作人或命令');
    }
  }

  private async loadSettlementDetail(tx: Prisma.TransactionClient, id: string) {
    const settlement = await tx.consignmentSettlement.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            code: true,
            name: true,
            contactName: true,
            contactPhone: true,
          },
        },
        createdBy: { select: { id: true, displayName: true } },
        submittedBy: { select: { id: true, displayName: true } },
        confirmedBy: { select: { id: true, displayName: true } },
        settledBy: { select: { id: true, displayName: true } },
        voidedBy: { select: { id: true, displayName: true } },
        lines: {
          include: {
            payableEntry: {
              include: {
                item: { select: { id: true, sku: true, name: true } },
                order: {
                  select: { id: true, orderNo: true, completedAt: true },
                },
                refund: {
                  select: { id: true, refundNo: true, completedAt: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        transitions: {
          include: { actor: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!settlement) throw new NotFoundException('寄售结算单不存在');
    return settlement;
  }
}
