import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CancelDocumentDto,
  CreateInventoryOperationDto,
  PostInventoryOperationDto,
} from '../inventory.dto.js';
import {
  operations,
  createOperation,
  submitOperation,
  approveOperation,
  postOperation,
  cancelOperation,
} from './inventory-operations-movements.commands.js';

@Injectable()
export class InventoryMovementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  operations(actor: AuthUser) {
    return operations(this.prisma, actor);
  }
  async createOperation(dto: CreateInventoryOperationDto, actor: AuthUser) {
    return createOperation(this.prisma, dto, actor);
  }
  submitOperation(id: string, actor: AuthUser) {
    return submitOperation(this.prisma, id, actor);
  }
  approveOperation(id: string, actor: AuthUser) {
    return approveOperation(this.prisma, id, actor);
  }
  async postOperation(
    id: string,
    dto: PostInventoryOperationDto,
    actor: AuthUser,
  ) {
    return postOperation(this.prisma, id, dto, actor);
  }
  cancelOperation(id: string, dto: CancelDocumentDto, actor: AuthUser) {
    return cancelOperation(this.prisma, id, dto, actor);
  }
}
