import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrderFinalizerService } from './order-finalizer.service.js';
import { PaymentsController } from './payments.controller.js';
import { WechatPayService } from './wechat-pay.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [PaymentsController],
  providers: [OrderFinalizerService, WechatPayService],
  exports: [OrderFinalizerService, WechatPayService],
})
export class PaymentsModule {}
