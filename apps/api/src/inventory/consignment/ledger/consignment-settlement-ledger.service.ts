import { Injectable } from '@nestjs/common';
import { AppRole, Prisma } from '../../../generated/prisma/client.js';
import {
  recordCompletedGoodsSale,
  recordSucceededGoodsRefund,
} from './consignment-settlement-ledger.commands.js';

@Injectable()
export class ConsignmentLedgerService {
  async recordCompletedGoodsSale(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    actorRole: AppRole,
  ) {
    return recordCompletedGoodsSale(tx, orderId, actorId, actorRole);
  }
  async recordSucceededGoodsRefund(
    tx: Prisma.TransactionClient,
    refundId: string,
    actorId: string,
    actorRole: AppRole,
  ) {
    return recordSucceededGoodsRefund(tx, refundId, actorId, actorRole);
  }
}
