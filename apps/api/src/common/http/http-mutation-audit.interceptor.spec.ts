import { ForbiddenException } from '@nestjs/common'
import { firstValueFrom, of, throwError } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import { AuditResult } from '../../generated/prisma/enums.js'
import { HttpMutationAuditInterceptor } from './http-mutation-audit.interceptor.js'

const context = (request: Record<string, unknown>, statusCode = 201) =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  }) as never

describe('HttpMutationAuditInterceptor', () => {
  it('records mutation transport evidence without persisting request payloads', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' })
    const interceptor = new HttpMutationAuditInterceptor({ auditLog: { create } } as never)
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/orders/order-1/refunds?debug=true',
      requestId: 'request-0001',
      ip: '127.0.0.1',
      socket: {},
      headers: {
        'user-agent': 'MicroMessenger/8.0.50',
        authorization: 'Bearer must-not-be-recorded',
      },
      body: { password: 'must-not-be-recorded' },
      user: { sub: 'user-1', displayName: '前台', roles: ['FRONT_DESK'] },
    }

    await expect(firstValueFrom(interceptor.intercept(context(request), { handle: () => of({ ok: true }) }))).resolves.toEqual({ ok: true })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-1',
        actorRole: 'FRONT_DESK',
        action: 'HTTP_POST',
        objectType: 'HttpMutation',
        objectId: '/api/v1/orders/order-1/refunds',
        result: AuditResult.SUCCESS,
        requestId: 'request-0001',
        ip: '127.0.0.1',
        deviceInfo: 'MicroMessenger/8.0.50',
        newValue: {
          method: 'POST',
          path: '/api/v1/orders/order-1/refunds',
          statusCode: 201,
        },
      }),
    })
    expect(JSON.stringify(create.mock.calls)).not.toContain('must-not-be-recorded')
  })

  it('does not add request-level rows for read-only calls', async () => {
    const create = vi.fn()
    const interceptor = new HttpMutationAuditInterceptor({ auditLog: { create } } as never)
    const request = { method: 'GET', url: '/api/v1/dashboard', headers: {}, socket: {} }

    await expect(firstValueFrom(interceptor.intercept(context(request, 200), { handle: () => of('ok') }))).resolves.toBe('ok')
    expect(create).not.toHaveBeenCalled()
  })

  it('records denied service mutations and preserves the original exception', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-2' })
    const interceptor = new HttpMutationAuditInterceptor({ auditLog: { create } } as never)
    const request = {
      method: 'PATCH',
      url: '/api/v1/governance/users/user-2',
      headers: {},
      socket: { remoteAddress: '10.0.0.8' },
      user: { sub: 'user-1', displayName: '财务', roles: ['FINANCE'] },
    }
    const denied = new ForbiddenException('无权操作')

    await expect(firstValueFrom(interceptor.intercept(context(request), { handle: () => throwError(() => denied) }))).rejects.toBe(denied)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        result: AuditResult.DENIED,
        ip: '10.0.0.8',
        newValue: expect.objectContaining({ statusCode: 403 }),
      }),
    })
  })

  it('never changes the business response when request-audit storage is unavailable', async () => {
    const interceptor = new HttpMutationAuditInterceptor({
      auditLog: { create: vi.fn().mockRejectedValue(new Error('audit database unavailable')) },
    } as never)
    const request = { method: 'DELETE', url: '/api/v1/resource/1', headers: {}, socket: {} }

    await expect(firstValueFrom(interceptor.intercept(context(request, 204), { handle: () => of('done') }))).resolves.toBe('done')
  })
})
