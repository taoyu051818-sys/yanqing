import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CancelDocumentDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from '../inventory.dto.js';
import {
  purchaseOrders,
  createPurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
} from './inventory-operations-purchasing.commands.js';

@Injectable()
export class InventoryPurchasingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  purchaseOrders(actor: AuthUser) {
    return purchaseOrders(this.prisma, actor);
  }
  async createPurchaseOrder(dto: CreatePurchaseOrderDto, actor: AuthUser) {
    return createPurchaseOrder(this.prisma, dto, actor);
  }
  submitPurchaseOrder(id: string, actor: AuthUser) {
    return submitPurchaseOrder(this.prisma, id, actor);
  }
  approvePurchaseOrder(id: string, actor: AuthUser) {
    return approvePurchaseOrder(this.prisma, id, actor);
  }
  async receivePurchaseOrder(
    id: string,
    dto: ReceivePurchaseOrderDto,
    actor: AuthUser,
  ) {
    return receivePurchaseOrder(this.prisma, id, dto, actor);
  }
  cancelPurchaseOrder(id: string, dto: CancelDocumentDto, actor: AuthUser) {
    return cancelPurchaseOrder(this.prisma, id, dto, actor);
  }
}
