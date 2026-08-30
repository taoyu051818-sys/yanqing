import { randomUUID } from 'node:crypto'

import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import type { NextFunction, Request, Response } from 'express'

import { AppModule } from './app.module.js'
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js'
import { ApiResponseInterceptor } from './common/http/api-response.interceptor.js'
import { HttpMutationAuditInterceptor } from './common/http/http-mutation-audit.interceptor.js'
import { PrismaService } from './database/prisma.service.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true })
  const config = app.get(ConfigService)
  const prefix = config.get<string>('API_PREFIX', 'api/v1')
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  app.use(helmet())
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    request.requestId = String(request.headers['x-request-id'] ?? randomUUID())
    response.setHeader('x-request-id', request.requestId)
    next()
  })
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
  app.setGlobalPrefix(prefix)
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  )
  app.useGlobalInterceptors(
    new HttpMutationAuditInterceptor(app.get(PrismaService)),
    new ApiResponseInterceptor(),
  )
  app.useGlobalFilters(new AllExceptionsFilter())

  const swaggerConfig = new DocumentBuilder()
    .setTitle('延庆羽毛球馆会员生态 API')
    .setDescription('场地、会员、球局、赛事、培训、联盟、库存与财务分账接口')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' })

  app.enableShutdownHooks()
  await app.listen(config.get<number>('PORT', 3200), '0.0.0.0')
}

await bootstrap()
