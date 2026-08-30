import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  BusinessType,
  PaymentChannel,
} from '../generated/prisma/enums.js'
import { OrdersService } from './orders.service.js'

const member: AuthUser = {
  sub: 'member-coupon-block',
  displayName: '支付安全测试会员',
  roles: [AppRole.MEMBER],
}

describe('OrdersService financial hardening', () => {
  it.each(Object.values(BusinessType))(
    'rejects COUPON before any read/write for %s orders',
    async (businessType) => {
      const touched = vi.fn()
      const prisma = new Proxy(
        {},
        {
          get: (_target, property) => {
            touched(String(property))
            throw new Error(`unexpected Prisma access: ${String(property)}`)
          },
        },
      )
      const config = { get: vi.fn() }
      const finalizer = { finalize: vi.fn() }
      const wechatPay = { createJsapiPayment: vi.fn() }
      const service = new OrdersService(
        prisma as never,
        config as never,
        finalizer as never,
        wechatPay as never,
      )

      await expect(
        service.pay(
          `order-${businessType.toLowerCase()}`,
          {
            channel: PaymentChannel.COUPON,
            idempotencyKey: `coupon-pay-${businessType.toLowerCase()}`,
          },
          member,
        ),
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(touched).not.toHaveBeenCalled()
      expect(config.get).not.toHaveBeenCalled()
      expect(finalizer.finalize).not.toHaveBeenCalled()
      expect(wechatPay.createJsapiPayment).not.toHaveBeenCalled()
    },
  )
})
