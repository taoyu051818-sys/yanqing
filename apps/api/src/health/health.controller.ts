import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { Public } from '../common/auth/auth.decorators.js'
import { HealthService } from './health.service.js'

@ApiTags('系统')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly service: HealthService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  health() {
    return {
      service: 'yanqing-api',
      status: 'ok',
      revision: this.service.revision,
      timestamp: new Date().toISOString(),
    }
  }

  @Public()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    if (!await this.service.databaseReady()) {
      throw new ServiceUnavailableException('Database readiness check failed')
    }
    return { ...this.health(), checks: { database: 'ok' } }
  }
}
