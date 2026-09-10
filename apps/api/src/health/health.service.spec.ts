import { ConfigService } from '@nestjs/config'
import { HealthService } from './health.service.js'
import type { PrismaService } from '../database/prisma.service.js'

describe('database readiness', () => {
  const query = vi.fn()
  const create = (revision = '') => new HealthService(
    { $queryRaw: query } as unknown as PrismaService,
    new ConfigService({ RELEASE_COMMIT: revision }),
  )
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('reports a failed connection and recovers on the next successful query', async () => {
    query.mockRejectedValueOnce(new Error('private connection details')).mockResolvedValueOnce([{ '?column?': 1 }])
    const service = create()
    expect(await service.databaseReady()).toBe(false)
    expect(await service.databaseReady()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds response time and shares a hung query across repeated probes', async () => {
    let finish!: () => void
    query.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const service = create()
    const first = service.databaseReady()
    const concurrent = service.databaseReady()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await first).toBe(false)
    expect(await concurrent).toBe(false)
    const retry = service.databaseReady()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await retry).toBe(false)
    expect(query).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    query.mockResolvedValueOnce([])
    expect(await service.databaseReady()).toBe(true)
    expect(query).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('only exposes a full Git revision, never arbitrary environment contents', () => {
    expect(create('a'.repeat(40)).revision).toBe('a'.repeat(40))
    expect(create('private-value').revision).toBe('unknown')
    expect(create().revision).toBe('unknown')
  })
})
