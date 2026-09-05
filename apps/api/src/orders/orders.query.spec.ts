import { describe, expect, it } from 'vitest'
import { ValidationPipe } from '@nestjs/common'
import { OrderQueryDto } from './orders.dto.js'
import { OrderStatus } from '../generated/prisma/enums.js'

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
const parse = (value: unknown) => pipe.transform(value, { type: 'query', metatype: OrderQueryDto })

describe('order list query transport compatibility', () => {
  it.each([undefined, '', 'undefined', 'null'])('treats an empty legacy filter %s as all orders', async (empty) => {
    const query = await parse({ page: '1', pageSize: '20', status: empty, businessType: empty })
    expect(query).toMatchObject({ page: 1, pageSize: 20, status: undefined, businessType: undefined })
  })
  it.each(Object.values(OrderStatus))('preserves the valid %s filter', async (status) => {
    expect(await parse({ status })).toMatchObject({ status })
  })
  it('still rejects invalid values and returns a readable Chinese message', async () => {
    try { await parse({ status: 'ALL_ORDERS' }); throw new Error('Expected validation failure') }
    catch (error: any) {
      expect(error.getStatus()).toBe(400)
      expect(error.getResponse().message).toEqual(['订单状态筛选无效，请重新选择'])
    }
  })
  it('does not bypass pagination or duplicate query validation', async () => {
    await expect(parse({ page: '0' })).rejects.toMatchObject({ status: 400 })
    await expect(parse({ status: ['undefined', 'PAID'] })).rejects.toMatchObject({ status: 400 })
    await expect(parse({ memberId: 'another-member' })).rejects.toMatchObject({ status: 400 })
  })
})
