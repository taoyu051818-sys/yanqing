import { Controller, Headers, Post, Req, Res } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { Public } from '../common/auth/auth.decorators.js'
import { WechatPayService } from './wechat-pay.service.js'

@ApiTags('支付通知')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly wechatPay: WechatPayService) {}

  @Public()
  @Post('wechat/notify')
  @ApiExcludeEndpoint()
  async notify(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() response: Response,
  ) {
    try {
      if (!request.rawBody) throw new Error('缺少原始通知正文')
      await this.wechatPay.handleNotification(request.rawBody, headers)
      response.status(200).json({ code: 'SUCCESS', message: '成功' })
    } catch (error) {
      response.status(500).json({ code: 'FAIL', message: error instanceof Error ? error.message : '处理失败' })
    }
  }
}
