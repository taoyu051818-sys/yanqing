import { Module } from '@nestjs/common'
import { GoodsController } from './goods.controller.js'
import { GoodsService } from './goods.service.js'

@Module({ controllers: [GoodsController], providers: [GoodsService] })
export class GoodsModule {}
