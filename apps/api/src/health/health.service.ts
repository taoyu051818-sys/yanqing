import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { PrismaService } from '../database/prisma.service.js'

@Injectable()
export class HealthService {
  readonly revision: string
  private databaseProbe?: Promise<boolean>

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const revision = config.get<string>('RELEASE_COMMIT', '')
    this.revision = /^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown'
  }

  async databaseReady(): Promise<boolean> {
    // A timed-out query may still occupy a connection. Reuse it until it settles
    // so repeated probes cannot exhaust the business connection pool.
    if (!this.databaseProbe) {
      const probe = Promise.resolve()
        .then(() => this.prisma.$queryRaw`SELECT 1`)
        .then(() => true, () => false)
      this.databaseProbe = probe
      void probe.then(() => { if (this.databaseProbe === probe) this.databaseProbe = undefined })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.databaseProbe,
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 2000) }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
