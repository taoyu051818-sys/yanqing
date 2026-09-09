import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../src/database/prisma.service.js'
import { GamesService } from '../src/games/games.service.js'
import { EventsService } from "./support/events-service-fixture.js"
import { OrdersService } from '../src/orders/orders.service.js'
import { WechatPayService } from '../src/payments/wechat-pay.service.js'
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js'
import type { AuthUser } from '../src/common/auth/auth-user.js'
import type { AppRole } from '../src/generated/prisma/enums.js'

// Explicit opt-in to an isolated local PostgreSQL database; never use DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
const unique = () => 'review2-' + randomUUID()
const day = 86_400_000
describe.skipIf(!url)('registration boundaries on PostgreSQL', () => {
  let db: PrismaService,
    games: GamesService,
    events: EventsService,
    orders: OrdersService
  beforeAll(async () => {
    const target = new URL(url!)
    if (
      !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error(
        'TEST_DATABASE_URL must point to a local database ending in _test',
      )
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }))
    await db.$connect()
    games = new GamesService(db)
    events = new EventsService(db)
    // Internal balance payments only. An accidental external call must fail.
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      new OrderFinalizerService({} as never),
      {} as never,
    )
  })
  afterAll(async () => {
    if (db) await db.$disconnect()
  })
  async function person(
    role: AppRole = 'MEMBER',
    expiredGold = false,
  ): Promise<AuthUser> {
    const user = await db.user.create({
      data: {
        displayName: '隔离审查用户',
        primaryRole: role,
        memberProfile: {
          create: {
            tags: [],
            level: expiredGold ? 'GOLD' : 'EXPERIENCE',
            membershipExpiresAt: expiredGold
              ? new Date(Date.now() - 30 * day)
              : null,
          },
        },
        accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
      },
    })
    return { sub: user.id, displayName: user.displayName, roles: [role] }
  }
  async function game(expired = false) {
    const host = await person('HOST')
    return db.game.create({
      data: {
        code: unique(),
        title: '隔离审查球局',
        hostId: host.sub,
        level: 'BEGINNER',
        status: 'OPEN',
        capacity: 4,
        feeCents: 8800,
        startsAt: new Date(Date.now() + (expired ? -2 : 1) * day),
        endsAt: new Date(Date.now() + (expired ? -1 : 2) * day),
      },
    })
  }
  async function event() {
    return db.event.create({
      data: {
        code: unique(),
        name: '隔离审查积分赛',
        status: 'OPEN',
        rules: [],
        startsAt: new Date(Date.now() + 2 * day),
        registrationEndsAt: new Date(Date.now() + day),
        capacityPeople: 24,
        minimumPeople: 24,
        totalRounds: 5,
        feeCents: 8800,
        memberFeeCents: 4400,
      },
    })
  }
  const signup = { sourceChannel: 'MINI_PROGRAM' as const }
  const manual = {
    name: '隔离队伍',
    category: 'MIXED_DOUBLES' as const,
    sourceChannel: 'MINI_PROGRAM' as const,
    registrationMode: 'MANUAL' as const,
    captainPlays: true,
    consent: true,
    playerAName: '测试甲',
    playerBName: '测试乙',
    playerAPhone: '13900000001',
    playerBPhone: '13900000002',
  }
  it('does not create or charge a registration after the game has ended', async () => {
    const g = await game(true),
      actor = await person()
    await expect(games.register(g.id, signup, actor)).rejects.toThrow(
      '报名已截止',
    )
    expect(await db.order.count({ where: { memberId: actor.sub } })).toBe(0)
    expect(
      (
        await db.account.findUniqueOrThrow({
          where: { userId_type: { userId: actor.sub, type: 'CASH_PRINCIPAL' } },
        })
      ).balance,
    ).toBe(100000)
  })
  it.each(['versioned', 'legacy'])(
    'can cancel and promote again after a %s historical promotion',
    async (keyKind) => {
      const g = await game(),
        occupants = await Promise.all(Array.from({ length: 4 }, () => person()))
      const occupied: any[] = []
      for (const actor of occupants)
        occupied.push(await games.register(g.id, signup, actor))
      const returning = await person()
      const first: any = await games.register(g.id, signup, returning)
      expect(first.status).toBe('WAITLISTED')
      await orders.cancelPending(
        occupied[0].id,
        { idempotencyKey: unique() },
        occupants[0],
      )
      const promoted = await db.gameRegistration.findUniqueOrThrow({
        where: { gameId_userId: { gameId: g.id, userId: returning.sub } },
      })
      expect(promoted.orderId).toBeTruthy()
      if (keyKind === 'legacy')
        await db.order.update({
          where: { id: promoted.orderId! },
          data: {
            creationIdempotencyKey: `SYSTEM:GAME_WAITLIST:${promoted.id}`,
          },
        })
      await orders.cancelPending(
        promoted.orderId!,
        { idempotencyKey: unique() },
        returning,
      )
      await games.register(g.id, signup, occupants[0])
      const queued: any = await games.register(g.id, signup, returning)
      expect(queued.status).toBe('WAITLISTED')
      // This cancellation releases the next seat and invokes the shared promotion
      // inside the real transaction. Reusing the old key must not block cancellation.
      await orders.cancelPending(
        occupied[1].id,
        { idempotencyKey: unique() },
        occupants[1],
      )
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: occupied[1].id } }))
          .status,
      ).toBe('CANCELLED')
      const second = await db.gameRegistration.findUniqueOrThrow({
        where: { id: promoted.id },
      })
      expect(second.status).toBe('REGISTERED')
      expect(second.orderId).not.toBe(promoted.orderId)
      expect(second.waitlistVersion).toBe(promoted.waitlistVersion + 1)
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: promoted.orderId! } }))
          .status,
      ).toBe('CANCELLED')
      await games.promoteWaitlist(g.id, { ...occupants[0], roles: ['ADMIN'] })
      expect(
        (
          await db.gameRegistration.findUniqueOrThrow({
            where: { id: promoted.id },
          })
        ).orderId,
      ).toBe(second.orderId)
    },
  )
  it.each(['COACH', 'HOST', 'FINANCE', 'MERCHANT'] as AppRole[])(
    'denies assisted signup to a %s without member/operator permission',
    async (role) => {
      const e = await event(),
        actor = await person(role),
        a = await person(),
        b = await person()
      await expect(
        events.register(
          e.id,
          {
            name: '角色边界测试',
            category: 'MIXED_DOUBLES',
            sourceChannel: 'MINI_PROGRAM',
            playerAName: '未授权甲',
            playerBName: '未授权乙',
            playerAUserId: a.sub,
            playerBUserId: b.sub,
          },
          actor,
        ),
      ).rejects.toThrow('会员身份')
      expect(await db.eventTeam.count({ where: { eventId: e.id } })).toBe(0)
    },
  )
  it.each(['COACH', 'HOST', 'FINANCE'] as AppRole[])(
    'keeps MEMBER + %s subject to partner authorization',
    async (role) => {
      const e = await event(),
        actor = await person(role)
      actor.roles.push('MEMBER')
      await expect(
        events.register(
          e.id,
          {
            name: '混合角色测试',
            category: 'MIXED_DOUBLES',
            sourceChannel: 'MINI_PROGRAM',
            playerAName: '甲',
            playerBName: '乙',
          },
          actor,
        ),
      ).rejects.toThrow('搭档本人生成的授权码')
    },
  )
  it.each(['FRONT_DESK', 'EVENT_MANAGER', 'ADMIN', 'SUPER_ADMIN'] as AppRole[])(
    'preserves authorized %s assisted registration',
    async (role) => {
      const e = await event(),
        actor = await person(role),
        a = await person(),
        b = await person()
      const result: any = await events.register(
        e.id,
        {
          name: '授权代报名测试',
          category: 'MIXED_DOUBLES',
          sourceChannel: 'MINI_PROGRAM',
          playerAName: '选手甲',
          playerBName: '选手乙',
          playerAUserId: a.sub,
          playerBUserId: b.sub,
        },
        actor,
      )
      const team = await db.eventTeam.findUniqueOrThrow({
        where: { orderId: result.id },
      })
      expect(team.playerAUserId).toBe(a.sub)
      expect(team.playerBUserId).toBe(b.sub)
    },
  )
  it('charges the public event price after a Gold membership has expired', async () => {
    const e = await event(),
      actor = await person('MEMBER', true)
    const result: any = await events.register(e.id, manual, actor)
    const stored = await db.order.findUniqueOrThrow({
      where: { id: result.id },
    })
    expect(
      stored.payableCents,
      'expired Gold status must not grant the member-only price',
    ).toBe(e.feeCents)
  })
  it('control: a normal member is already prevented from supplying another member account directly', async () => {
    const e = await event(),
      actor = await person()
    await expect(
      events.register(
        e.id,
        {
          name: '普通会员权限对照',
          category: 'MIXED_DOUBLES',
          sourceChannel: 'MINI_PROGRAM',
          playerAName: '甲',
          playerBName: '乙',
          playerBUserId: unique(),
        },
        actor,
      ),
    ).rejects.toThrow('搭档本人生成的授权码')
  })
  it('uses the valid membership price and records the eligibility evidence', async () => {
    const e = await event(),
      actor = await person('MEMBER', true)
    await db.memberProfile.update({
      where: { userId: actor.sub },
      data: { membershipExpiresAt: new Date(Date.now() + day) },
    })
    const result: any = await events.register(e.id, manual, actor)
    const stored = await db.order.findUniqueOrThrow({
      where: { id: result.id },
    })
    expect(stored.payableCents).toBe(e.memberFeeCents)
    expect(stored.parameterSnapshot).toMatchObject({
      membershipEligibility: {
        eligible: true,
        reason: 'ACTIVE',
        level: 'GOLD',
      },
    })
  })
  it('places a returning historical registration behind members already waiting', async () => {
    const g = await game(),
      occupants = await Promise.all(Array.from({ length: 4 }, () => person()))
    const occupied: any[] = []
    for (const actor of occupants)
      occupied.push(await games.register(g.id, signup, actor))
    await orders.cancelPending(
      occupied[0].id,
      { idempotencyKey: unique() },
      occupants[0],
    )
    await games.register(g.id, signup, await person())
    const olderWaiter = await person()
    await games.register(g.id, signup, olderWaiter)
    await db.gameRegistration.update({
      where: { gameId_userId: { gameId: g.id, userId: olderWaiter.sub } },
      data: { waitlistedAt: new Date(Date.now() - 1000) },
    })
    await games.register(g.id, signup, occupants[0])
    expect(
      (await games.participants(g.id, occupants[0])).myRegistration
        ?.waitlistPosition,
    ).toBe(2)
    expect(
      (await games.participants(g.id, olderWaiter)).myRegistration
        ?.waitlistPosition,
    ).toBe(1)
    await orders.cancelPending(
      occupied[1].id,
      { idempotencyKey: unique() },
      occupants[1],
    )
    expect(
      (
        await db.gameRegistration.findUniqueOrThrow({
          where: { gameId_userId: { gameId: g.id, userId: olderWaiter.sub } },
        })
      ).status,
    ).toBe('REGISTERED')
    expect(
      (
        await db.gameRegistration.findUniqueOrThrow({
          where: { gameId_userId: { gameId: g.id, userId: occupants[0].sub } },
        })
      ).status,
    ).toBe('WAITLISTED')
  })
  it('does not permit a client order to occupy the system promotion namespace', async () => {
    const g = await game(),
      actor = await person()
    await expect(
      games.register(
        g.id,
        {
          ...signup,
          creationIdempotencyKey: 'SYSTEM:GAME_WAITLIST:reserved:1',
        },
        actor,
      ),
    ).rejects.toThrow('仅供系统')
    const e = await event()
    await expect(
      events.register(
        e.id,
        {
          ...manual,
          creationIdempotencyKey: 'SYSTEM:GAME_WAITLIST:reserved:2',
        },
        actor,
      ),
    ).rejects.toThrow('仅供系统')
    expect(await db.order.count({ where: { memberId: actor.sub } })).toBe(0)
  })
  it('rejects an unpaid order once the game starts, and the sweeper closes it before 15 minutes', async () => {
    const g = await game(),
      actor = await person()
    const result: any = await games.register(g.id, signup, actor)
    await db.game.update({
      where: { id: g.id },
      data: { startsAt: new Date(Date.now() - 1000) },
    })
    expect(
      (await orders.paymentOptions(result.id, actor)).options.every(
        (option) => !option.enabled,
      ),
    ).toBe(true)
    await expect(
      orders.pay(
        result.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: unique() },
        actor,
      ),
    ).rejects.toThrow('支付保留期')
    await orders.expirePendingOrders()
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: result.id } })).status,
    ).toBe('CANCELLED')
    expect(await db.payment.count({ where: { orderId: result.id } })).toBe(0)
  })
  it('records a late WeChat game payment for compensation without confirming the seat', async () => {
    const g = await game(),
      actor = await person()
    const result: any = await games.register(g.id, signup, actor)
    const provider = {
      createJsapiPayment: vi
        .fn()
        .mockResolvedValue({ package: 'prepay_id=test' }),
    }
    const config = new ConfigService({ PAYMENT_PROVIDER: 'wechat' })
    const finalizer = new OrderFinalizerService({} as never)
    const paying = new OrdersService(db, config, finalizer, provider as never)
    await db.user.update({
      where: { id: actor.sub },
      data: { openId: unique() },
    })
    const payKey = unique()
    await paying.pay(
      result.id,
      { channel: 'WECHAT', idempotencyKey: payKey },
      actor,
    )
    await db.game.update({
      where: { id: g.id },
      data: { startsAt: new Date(Date.now() - 1000) },
    })
    await expect(
      paying.pay(
        result.id,
        { channel: 'WECHAT', idempotencyKey: payKey },
        actor,
      ),
    ).rejects.toThrow('截止报名')
    expect(provider.createJsapiPayment).toHaveBeenCalledOnce()
    const callback = new WechatPayService(config, db, finalizer)
    vi.spyOn(callback as any, 'verifyWechatSignature').mockImplementation(
      () => {},
    )
    vi.spyOn(callback as any, 'decrypt').mockReturnValue({
      out_trade_no: result.orderNo,
      transaction_id: unique(),
      trade_state: 'SUCCESS',
      amount: { total: 8800 },
    })
    const receive = () =>
      callback.handleNotification(
        Buffer.from(
          JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: {} }),
        ),
        {
          'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
          'wechatpay-nonce': 'test',
          'wechatpay-signature': 'test',
          'wechatpay-serial': 'test',
        },
      )
    await receive()
    await receive()
    expect(
      await db.order.findUniqueOrThrow({ where: { id: result.id } }),
    ).toMatchObject({ status: 'REFUND_PENDING', paidCents: 8800 })
    expect(
      (
        await db.gameRegistration.findUniqueOrThrow({
          where: { orderId: result.id },
        })
      ).status,
    ).toBe('CANCELLED')
    const refunds = await db.refund.findMany({ where: { orderId: result.id } })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]).toMatchObject({
      compensationOnly: true,
      status: 'REQUESTED',
      amountCents: 8800,
    })
    expect(
      await db.riskEvent.count({
        where: { orderId: result.id, ruleCode: 'BOSS_LATE_PAYMENT' },
      }),
    ).toBe(1)
  })
})
