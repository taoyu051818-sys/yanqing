import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { InventoryTransactionDto } from '../inventory.dto.js';
import { transact } from './inventory-transactions.commands.js';

@Injectable()
export class InventoryTransactionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async transact(
    itemId: string,
    dto: InventoryTransactionDto,
    actor: AuthUser,
  ) {
    return transact(this.prisma, itemId, dto, actor);
  }
}
