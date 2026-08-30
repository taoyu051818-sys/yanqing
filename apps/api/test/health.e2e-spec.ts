import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { HealthController } from '../src/health/health.controller.js'
import { ApiResponseInterceptor } from '../src/common/http/api-response.interceptor.js'

describe('public health endpoint (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [HealthController] }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalInterceptors(new ApiResponseInterceptor())
    await app.init()
  })

  afterAll(() => app.close())

  it('returns the standard API envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    expect(response.body.code).toBe(0)
    expect(response.body.data).toMatchObject({ service: 'yanqing-api', status: 'ok' })
  })
})
