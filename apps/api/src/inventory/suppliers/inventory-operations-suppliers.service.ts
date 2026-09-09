import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateSupplierDto,
  SetMasterDataStatusDto,
  UpdateSupplierDto,
} from '../inventory.dto.js';
import {
  suppliers,
  supplierDetail,
  createSupplier,
  updateSupplier,
  setSupplierStatus,
} from './inventory-operations-suppliers.commands.js';

@Injectable()
export class InventorySuppliersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  suppliers(actor: AuthUser) {
    return suppliers(this.prisma, actor);
  }
  async supplierDetail(id: string, actor: AuthUser) {
    return supplierDetail(this.prisma, id, actor);
  }
  async createSupplier(dto: CreateSupplierDto, actor: AuthUser) {
    return createSupplier(this.prisma, dto, actor);
  }
  async updateSupplier(id: string, dto: UpdateSupplierDto, actor: AuthUser) {
    return updateSupplier(this.prisma, id, dto, actor);
  }
  async setSupplierStatus(
    id: string,
    dto: SetMasterDataStatusDto,
    actor: AuthUser,
  ) {
    return setSupplierStatus(this.prisma, id, dto, actor);
  }
}
