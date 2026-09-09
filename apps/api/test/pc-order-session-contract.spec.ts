import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, afterEach } from 'vitest'
import ts from 'typescript'
import { createRequire } from 'node:module'
const { ref, computed, watch } = createRequire(new URL('../../admin/package.json', import.meta.url))('vue')
import { OrdersService } from '../src/orders/orders.service.js'
import { OrdersController } from '../src/orders/orders.controller.js'
import { AppRole, OrderStatus } from '../src/generated/prisma/enums.js'

// Execute the current PC script, excluding imports and mounting side effects.
// The API/controller/service are real; native fetch and database reads are isolated.
function runSource(source: string, dependencies: Record<string, unknown>, exports: string[]) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [context => file => ts.visitNode(file, function visit(node): any {
      return ts.isImportDeclaration(node) ? undefined : ts.visitEachChild(node, visit, context)
    }) as ts.SourceFile] },
  }).outputText.replace(/^export /gm, '').replace(/^\{\};?$/gm, '')
  return new Function(...Object.keys(dependencies), js + ';return {' + exports.join(',') + '}')(...Object.values(dependencies))
}
const pcApi = () => runSource(readFileSync('../admin/src/api.ts', 'utf8'), { ref, watch }, ['api', 'session', 'query'])
const app = (transport: ReturnType<typeof pcApi>) => {
  const source = readFileSync('../admin/src/App.vue', 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  return runSource(source, {
    ...transport, ref, computed, onMounted: () => {}, onUnmounted: () => {}, watch,
    location: { hash: '#orders' },
  }, ['load', 'open', 'logout', 'items', 'total', 'selected', 'tab', 'go'])
}
const identity = (id: string) => ({ user: { id, displayName: id, roles: ['ADMIN'] }, sessionId: id + '-session', csrfToken: id + '-csrf' })
const response = (status: number, data?: unknown) => ({ ok: status < 300, status, json: async () => status < 300 ? { code: 0, data } : { message: '旧登录已过期' } })
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r }); return { promise, resolve } }

afterEach(() => vi.unstubAllGlobals())

describe('PC management order query contract', () => {
  it.each([AppRole.ADMIN, AppRole.FINANCE])('PC %s sees member-created and assisted orders with member names', async role => {
    const actor = { sub: 'operator', displayName: '操作员', roles: [role] }
    const fixtures = [
      { id: 'own', memberId: actor.sub, createdById: actor.sub },
      { id: 'member-self', memberId: 'member-a', createdById: 'member-a' },
      { id: 'assisted', memberId: 'member-b', createdById: actor.sub },
    ].map(row => ({ ...row, orderNo: row.id, businessType: 'VENUE', status: OrderStatus.PAID, payableCents: 6000, createdAt: new Date() }))
    const filters: any[] = []
    const select = (where: any) => fixtures.filter(row => !where.memberId || row.memberId === where.memberId)
    const prisma = {
      order: {
        findMany: vi.fn(async ({ where, include }: any) => {
          filters.push(where)
          return select(where).map(row => ({ ...row, ...(include.member ? { member: { id: row.memberId, displayName: row.memberId } } : {}) }))
        }),
        count: vi.fn(async ({ where }: any) => select(where).length),
      },
      $transaction: async (queries: any[]) => Promise.all(queries),
    }
    const controller = new OrdersController(new OrdersService(prisma as never, {} as never, {} as never, {} as never))
    const paths: string[] = []
    vi.stubGlobal('fetch', async (path: string) => {
      paths.push(path)
      const url = new URL(path, 'http://isolated.test')
      const query = { page: 1, pageSize: 20 }
      return response(200, url.pathname === '/api/v1/orders/admin/all'
        ? await controller.all(actor, query)
        : await controller.myOrders(actor, query))
    })
    const transport = pcApi(); transport.session.value = identity(actor.sub)
    const page = app(transport)
    await page.load()
    expect(paths[0]).toBe('/api/v1/orders/admin/all?page=1&pageSize=20')
    expect(filters[0].memberId).toBeUndefined()
    expect(page.items.value.map((r: any) => r.id)).toEqual(['own', 'member-self', 'assisted'])
    expect(page.total.value).toBe(3)
    const all = await controller.all(actor, { page: 1, pageSize: 20 })
    expect(all.total).toBe(3)
    expect(all.items.map(r => r.id)).toContain('assisted')
    expect(all.items.map(r => r.member?.displayName)).toEqual(['operator', 'member-a', 'member-b'])
    expect(prisma.order.findMany.mock.calls[0][0].include.member).toEqual({ select: { id: true, displayName: true } })
    const personal = await controller.myOrders(actor, { page: 1, pageSize: 20 })
    expect(personal.items.map(r => r.id)).toEqual(['own'])
    expect(personal.items[0].member).toBeUndefined()
  })
})

describe('PC authentication and late responses', () => {
  it('an old 401 cannot clear a newly established PC session', async () => {
    const pending = deferred()
    vi.stubGlobal('fetch', () => pending.promise)
    const { api, session } = pcApi()
    session.value = identity('old')
    const request = api('/orders')
    const rejected = expect(request).rejects.toThrow('登录状态已更新')
    session.value = identity('new')
    pending.resolve(response(401))
    await rejected
    expect(session.value.user.id).toBe('new')
  })

  it('discards old detail responses after switching accounts', async () => {
    const pending = deferred()
    vi.stubGlobal('fetch', (path: string) => path.includes('/orders/old-order')
      ? pending.promise : Promise.resolve(response(200, path.includes('/logout') ? {} : { items: [], total: 0 })))
    const transport = pcApi(); transport.session.value = identity('old')
    const page = app(transport)
    const opening = page.open({ id: 'old-order' })
    await page.logout()
    transport.session.value = identity('new')
    page.go('orders')
    expect(page.selected.value).toBeNull()
    pending.resolve(response(200, { id: 'old-order', member: { displayName: '旧会员' } }))
    await opening
    expect(transport.session.value.user.id).toBe('new')
    expect(page.selected.value).toBeNull()
  })

  it('current-session 401 correctly clears authentication (control)', async () => {
    vi.stubGlobal('fetch', async () => response(401))
    const { api, session } = pcApi(); session.value = identity('current')
    await expect(api('/orders')).rejects.toThrow()
    expect(session.value).toBeNull()
  })
})


describe('PC detail and QR result ownership', () => {
  it('closing a detail prevents a late response from reopening it', async () => {
    const pending = deferred()
    vi.stubGlobal('fetch', () => pending.promise)
    const transport = pcApi(); transport.session.value = identity('current')
    const page = app(transport)
    const opening = page.open({ id: 'closed-order' })
    page.selected.value = null
    pending.resolve(response(200, { id: 'closed-order' }))
    await opening
    expect(page.selected.value).toBeNull()
  })

  it('does not replace the latest selected order with an earlier detail response', async () => {
    const first = deferred(), second = deferred()
    vi.stubGlobal('fetch', (path: string) => path.endsWith('/first') ? first.promise : second.promise)
    const transport = pcApi(); transport.session.value = identity('current')
    const page = app(transport)
    const openingFirst = page.open({ id: 'first' })
    const openingSecond = page.open({ id: 'second' })
    second.resolve(response(200, { id: 'second', title: '最新详情' }))
    await openingSecond
    first.resolve(response(200, { id: 'first' }))
    await openingFirst
    expect(page.selected.value.id).toBe('second')
  })

  it('classifies an obsolete network failure without disturbing the new login', async () => {
    let fail!: (cause: Error) => void
    vi.stubGlobal('fetch', () => new Promise((_, reject) => { fail = reject }))
    const { api, session } = pcApi(); session.value = identity('old')
    const result = api('/orders')
    const rejected = expect(result).rejects.toThrow('登录状态已更新')
    session.value = identity('new')
    fail(new Error('网络错误'))
    await rejected
    expect(session.value.user.id).toBe('new')
  })

  it.each([false, true])('QR exchange only publishes while mounted (disposed=%s)', async disposed => {
    const exchange = deferred()
    const transport = pcApi()
    const api = vi.fn(async (path: string) => path.endsWith('/exchange') ? exchange.promise : { status: 'APPROVED' })
    let unmount!: () => void
    const source = readFileSync('../admin/src/components/Login.vue', 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
    const page = runSource(source, { ref, api, session: transport.session, onMounted: () => {}, onUnmounted: (fn: () => void) => { unmount = fn } }, ['poll', 'start', 'challenge', 'busy'])
    page.challenge.value = { id: 'qr' }
    const polling = page.poll(0)
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    expect(page.busy.value).toBe(true)
    await page.start()
    expect(api).toHaveBeenCalledTimes(2)
    if (disposed) unmount()
    exchange.resolve(identity('scanned'))
    await polling
    expect(transport.session.value?.user.id ?? null).toBe(disposed ? null : 'scanned')
  })
})
