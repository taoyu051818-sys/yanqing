import { createHash } from 'node:crypto'

import { BadRequestException, ConflictException } from '@nestjs/common'

import type { PrismaService } from '../database/prisma.service.js'
import { Prisma } from '../generated/prisma/client.js'

export interface OrderCreationFields {
  creationIdempotencyKey?: string
  creationCommandHash?: string
}

interface ExistingCreation {
  id: string
  memberId: string
  creationCommandHash: string | null
}

interface ExecuteOrderCreationOptions<T> {
  memberId: string
  creationIdempotencyKey?: string
  command: unknown
  loadExisting: (orderId: string) => Promise<T>
  create: (fields: OrderCreationFields) => Promise<T>
}

const canonicalize = (value: unknown): unknown => {
  if (value === undefined) return null
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return String(value)
}

export const orderCreationCommandHash = (command: unknown) => createHash('sha256')
  .update(JSON.stringify({ version: 1, command: canonicalize(command) }))
  .digest('hex')

const targetIncludesCreationKey = (target: unknown) => {
  if (Array.isArray(target)) return target.some((item) => String(item).includes('creationIdempotencyKey'))
  if (typeof target === 'string') return target.includes('creationIdempotencyKey')
  return target !== null && typeof target === 'object' && JSON.stringify(target).includes('creationIdempotencyKey')
}

export const isOrderCreationKeyViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  targetIncludesCreationKey(error.meta?.target)

const assertReplay = (existing: ExistingCreation, memberId: string, commandHash: string) => {
  if (existing.memberId !== memberId || existing.creationCommandHash !== commandHash) {
    throw new ConflictException('订单创建幂等键已用于不同命令')
  }
}

export async function executeOrderCreation<T>(
  prisma: PrismaService,
  options: ExecuteOrderCreationOptions<T>,
): Promise<T> {
  const key = options.creationIdempotencyKey?.trim()
  if (!key) return options.create({})
  if (key.length < 8 || key.length > 100) throw new BadRequestException('订单创建幂等键长度必须为8-100个字符')

  const commandHash = orderCreationCommandHash(options.command)
  const findExisting = () => prisma.order.findUnique({
    where: { creationIdempotencyKey: key },
    select: { id: true, memberId: true, creationCommandHash: true },
  })
  const existing = await findExisting()
  if (existing) {
    assertReplay(existing, options.memberId, commandHash)
    return options.loadExisting(existing.id)
  }

  try {
    return await options.create({ creationIdempotencyKey: key, creationCommandHash: commandHash })
  } catch (error) {
    if (!isOrderCreationKeyViolation(error)) throw error
    const concurrent = await findExisting()
    if (!concurrent) throw error
    assertReplay(concurrent, options.memberId, commandHash)
    return options.loadExisting(concurrent.id)
  }
}
