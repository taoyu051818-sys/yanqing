import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { Public } from '../common/auth/auth.decorators.js'

@ApiTags('系统')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return {
      service: 'yanqing-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  }
}
