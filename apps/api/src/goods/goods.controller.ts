import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { CreateGoodsOrderDto } from './goods.dto.js'
import { GoodsService } from './goods.service.js'

@ApiTags('场馆商品')
@ApiBearerAuth()
@Controller('goods')
export class GoodsController {
  constructor(private readonly goods: GoodsService) {}

  @Get()
  products() { return this.goods.products() }

  @Post('orders')
  createOrder(@Body() dto: CreateGoodsOrderDto, @CurrentUser() actor: AuthUser) {
    return this.goods.createOrder(dto, actor)
  }
}
