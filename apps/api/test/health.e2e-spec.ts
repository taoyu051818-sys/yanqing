import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { HealthController } from '../src/health/health.controller.js'
import { ApiResponseInterceptor } from '../src/common/http/api-response.interceptor.js'
import { AllExceptionsFilter } from '../src/common/http/all-exceptions.filter.js'
import { HealthService } from '../src/health/health.service.js'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../src/database/prisma.service.js'

describe('public health endpoint (e2e)', () => {
  let app: INestApplication
  const query = vi.fn()

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: query } },
        { provide: ConfigService, useValue: new ConfigService({ RELEASE_COMMIT: 'a'.repeat(40) }) },
      ],
    }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalInterceptors(new ApiResponseInterceptor())
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()
  })

  afterAll(() => app.close())
  beforeEach(() => { query.mockReset(); query.mockResolvedValue([{ '?column?': 1 }]) })

  it('returns the standard API envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    expect(response.body.code).toBe(0)
    expect(response.body.data).toMatchObject({ service: 'yanqing-api', status: 'ok' })
    expect(query).not.toHaveBeenCalled()
  })

  it('returns database readiness and the deployed revision without authentication or caching', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.data).toMatchObject({ revision: 'a'.repeat(40), checks: { database: 'ok' } })
    expect(query).toHaveBeenCalledOnce()
  })

  it('returns 503 without connection details on failure, while liveness stays available', async () => {
    query.mockRejectedValueOnce(new Error('postgresql://private:secret@database/production'))
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503)
    expect(response.body).toMatchObject({ code: 503, data: null })
    expect(JSON.stringify(response.body)).not.toContain('secret')
    await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200)
  })
})
