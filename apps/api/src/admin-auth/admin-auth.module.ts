import { Global, Module } from '@nestjs/common'
import { AdminAuthController } from './admin-auth.controller.js'
import { AdminAuthService } from './admin-auth.service.js'
@Global()
@Module({ controllers: [AdminAuthController], providers: [AdminAuthService], exports: [AdminAuthService] })
export class AdminAuthModule {}
