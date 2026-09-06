import 'reflect-metadata'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { vi } from 'vitest'

import { AuthController } from '../src/auth/auth.controller.js'
import { AuthService } from '../src/auth/auth.service.js'
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard.js'
import { AppRole, UserStatus } from '../src/generated/prisma/enums.js'

describe('login closure over HTTP (isolated identity store)', () => {
  let app: INestApplication
  let jwt: JwtService
  const values: Record<string, string> = {
    NODE_ENV: 'staging', DEV_LOGIN_ENABLED: 'false',
    WECHAT_APP_ID: 'test-app', WECHAT_APP_SECRET: 'test-secret',
  }
  const savedUser = {
    id: 'wechat-user', displayName: '会员', primaryRole: AppRole.MEMBER,
    status: UserStatus.ACTIVE, deletedAt: null, roles: [{ role: AppRole.MEMBER }],
    accounts: [], memberProfile: null,
  }
  const prisma = {
    user: {
      findUnique: vi.fn(async () => savedUser),
      findUniqueOrThrow: vi.fn(async () => savedUser),
      findFirst: vi.fn(async () => savedUser),
    },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({
      user: { upsert: vi.fn(async () => savedUser) },
      account: { upsert: vi.fn(async () => ({})) },
    })),
  }

  beforeAll(async () => {
    // Vite does not emit constructor metadata; retain the production controller.
    Reflect.defineMetadata('design:paramtypes', [AuthService], AuthController)
    const config = { get: (key: string, fallback?: string) => values[key] ?? fallback }
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'isolated-http-test-secret-at-least-32-chars', signOptions: { expiresIn: '5m' } })],
      controllers: [AuthController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: AuthService, inject: [JwtService], useFactory: (service: JwtService) => new AuthService(prisma as never, service, config as never) },
        { provide: APP_GUARD, inject: [JwtService, Reflector], useFactory: (service: JwtService, reflector: Reflector) => new JwtAuthGuard(service, reflector, prisma as never, config as never) },
      ],
    }).compile()
    jwt = module.get(JwtService)
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  beforeEach(() => {
    values.DEV_LOGIN_ENABLED = 'false'
    savedUser.status = UserStatus.ACTIVE
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllGlobals())
  afterAll(() => app.close())

  it('blocks direct development login without reading any account', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/dev-login').send({ role: 'SUPER_ADMIN' }).expect(401)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it.each([undefined, 'development'])('rejects a correctly signed old/development token (%s)', async (loginMethod) => {
    const token = await jwt.signAsync({ sub: savedUser.id, loginMethod, roles: ['SUPER_ADMIN'] })
    await request(app.getHttpServer()).get('/api/v1/auth/me').auth(token, { type: 'bearer' }).expect(401)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('keeps a fresh WeChat login working while development login is closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ openid: 'test-openid' }) })))
    const login = await request(app.getHttpServer()).post('/api/v1/auth/wechat-login').send({ code: 'test-one-time-code' }).expect(201)
    expect(await jwt.verifyAsync(login.body.accessToken)).toMatchObject({ sub: savedUser.id, loginMethod: 'wechat' })
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').auth(login.body.accessToken, { type: 'bearer' }).expect(200)
    expect(me.body.id).toBe(savedUser.id)
    savedUser.status = UserStatus.DISABLED
    await request(app.getHttpServer()).get('/api/v1/auth/me').auth(login.body.accessToken, { type: 'bearer' }).expect(401)
  })

  it('revokes a development session on the very next request after closure', async () => {
    values.DEV_LOGIN_ENABLED = 'true'
    const login = await request(app.getHttpServer()).post('/api/v1/auth/dev-login').send({ userId: savedUser.id }).expect(201)
    const token = login.body.accessToken
    expect(await jwt.verifyAsync(token)).toMatchObject({ loginMethod: 'development' })
    await request(app.getHttpServer()).get('/api/v1/auth/me').auth(token, { type: 'bearer' }).expect(200)
    values.DEV_LOGIN_ENABLED = 'false'
    await request(app.getHttpServer()).get('/api/v1/auth/me').auth(token, { type: 'bearer' }).expect(401)
  })
})
