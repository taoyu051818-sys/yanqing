import { canExecuteDirectly } from '../../common/auth/admin-execution.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AccountAdjustmentQueryDto,
  AdjustAccountDto,
  ReviewAccountAdjustmentDto,
} from '../members.dto.js';
import {
  accountTransactions,
  accountAdjustmentRequests,
  adjustAccount,
  approveAccountAdjustment,
  rejectAccountAdjustment,
} from './members-accounts.commands.js';

@Injectable()
export class MemberAccountsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async accountTransactions(userId: string) {
    return accountTransactions(this.prisma, userId);
  }
  async accountAdjustmentRequests(
    query: AccountAdjustmentQueryDto,
    actor: AuthUser,
  ) {
    return accountAdjustmentRequests(this.prisma, query, actor);
  }
  async adjustAccount(userId: string, dto: AdjustAccountDto, actor: AuthUser) {
    const result = await adjustAccount(this.prisma, userId, dto, actor);
    if (!canExecuteDirectly(actor) || result.status !== 'REQUESTED')
      return result;
    return approveAccountAdjustment(
      this.prisma,
      result.id,
      { reason: dto.reason },
      actor,
    );
  }
  async approveAccountAdjustment(
    requestId: string,
    dto: ReviewAccountAdjustmentDto,
    actor: AuthUser,
  ) {
    return approveAccountAdjustment(this.prisma, requestId, dto, actor);
  }
  async rejectAccountAdjustment(
    requestId: string,
    dto: ReviewAccountAdjustmentDto,
    actor: AuthUser,
  ) {
    return rejectAccountAdjustment(this.prisma, requestId, dto, actor);
  }
}
