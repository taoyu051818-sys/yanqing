import 'reflect-metadata'

import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'

import { CreateRechargeDto } from './memberships.dto.js'

describe('CreateRechargeDto trust boundary', () => {
  it('accepts only a server-owned plan reference', async () => {
    const dto = plainToInstance(CreateRechargeDto, {
      planId: 'recharge-plan-1',
      creationIdempotencyKey: 'recharge-create-1',
    })

    await expect(validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })).resolves.toHaveLength(0)
  })

  it.each([
    { principalCents: 10_000 },
    { giftCents: 9_999_999 },
    { principalCents: 10_000, giftCents: 500 },
  ])('rejects legacy client-controlled amount fields: %j', async (legacy) => {
    const dto = plainToInstance(CreateRechargeDto, {
      planId: 'recharge-plan-1',
      creationIdempotencyKey: 'recharge-create-2',
      ...legacy,
    })

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })

    expect(errors.some((error) =>
      ['principalCents', 'giftCents'].includes(error.property),
    )).toBe(true)
  })
})
