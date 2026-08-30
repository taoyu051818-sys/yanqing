import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { catchError, concatMap, from, Observable, of, throwError } from 'rxjs'

import { PrismaService } from '../../database/prisma.service.js'
import { AuditResult } from '../../generated/prisma/enums.js'
import type { AuthUser } from '../auth/auth-user.js'

type AuditedRequest = Request & {
  requestId?: string
  user?: AuthUser
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const compactDeviceInfo = (request: AuditedRequest) => {
  const userAgent = request.headers['user-agent']
  const value = Array.isArray(userAgent) ? userAgent[0] : userAgent
  return value?.trim().slice(0, 500) || undefined
}

const requestPath = (request: AuditedRequest) =>
  (request.originalUrl || request.url || '/').split('?')[0]

const httpStatus = (error: unknown) => {
  if (!error || typeof error !== 'object') return 500
  if ('getStatus' in error && typeof error.getStatus === 'function') {
    const status = error.getStatus()
    return typeof status === 'number' ? status : 500
  }
  if ('status' in error && typeof error.status === 'number') return error.status
  return 500
}

/**
 * Adds request-level evidence for every authenticated mutation without
 * copying transport metadata into all domain services.  Domain audit rows
 * remain the authoritative, transactional old/new-value trail; this row
 * supplies requestId, IP, device and the HTTP outcome and never stores bodies,
 * cookies, authorization headers or tokens.
 */
@Injectable()
export class HttpMutationAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpMutationAuditInterceptor.name)

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditedRequest>()
    if (!request || !MUTATING_METHODS.has(request.method?.toUpperCase())) {
      return next.handle()
    }
    const response = context.switchToHttp().getResponse<Response>()

    return next.handle().pipe(
      concatMap((value) =>
        from(this.record(request, response.statusCode || 200, AuditResult.SUCCESS)).pipe(
          catchError((error) => {
            this.logWriteFailure(error)
            return of(undefined)
          }),
          concatMap(() => of(value)),
        ),
      ),
      catchError((error: unknown) => {
        const status = httpStatus(error)
        const result = status === 401 || status === 403 ? AuditResult.DENIED : AuditResult.FAILURE
        return from(this.record(request, status, result)).pipe(
          catchError((auditError) => {
            this.logWriteFailure(auditError)
            return of(undefined)
          }),
          concatMap(() => throwError(() => error)),
        )
      }),
    )
  }

  private record(request: AuditedRequest, statusCode: number, result: AuditResult) {
    const path = requestPath(request)
    const actorRole = request.user?.roles[0]
    return this.prisma.auditLog.create({
      data: {
        actorId: request.user?.sub,
        actorRole,
        action: `HTTP_${request.method.toUpperCase()}`,
        objectType: 'HttpMutation',
        objectId: path,
        newValue: {
          method: request.method.toUpperCase(),
          path,
          statusCode,
        },
        result,
        requestId: request.requestId,
        ip: request.ip || request.socket?.remoteAddress,
        deviceInfo: compactDeviceInfo(request),
      },
    })
  }

  private logWriteFailure(error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown audit write error'
    this.logger.warn(`request mutation audit could not be persisted: ${message}`)
  }
}
