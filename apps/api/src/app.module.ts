import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'

import { AuditModule } from './audit/audit.module.js'
import { AuthModule } from './auth/auth.module.js'
import { JwtAuthGuard } from './common/auth/jwt-auth.guard.js'
import { RolesGuard } from './common/auth/roles.guard.js'
import { ConfigurationModule } from './configuration/configuration.module.js'
import { validateEnvironment } from './configuration/env.validation.js'
import { DatabaseModule } from './database/database.module.js'
import { HealthController } from './health/health.controller.js'
import { MembersModule } from './members/members.module.js'
import { OrdersModule } from './orders/orders.module.js'
import { OperationsModule } from './operations/operations.module.js'
import { VenuesModule } from './venues/venues.module.js'
import { TrainingModule } from './training/training.module.js'
import { EventsModule } from './events/events.module.js'
import { AllianceModule } from './alliance/alliance.module.js'
import { GamesModule } from './games/games.module.js'
import { ReferralsModule } from './referrals/referrals.module.js'
import { DashboardModule } from './dashboard/dashboard.module.js'
import { InventoryModule } from './inventory/inventory.module.js'
import { ReportsModule } from './reports/reports.module.js'
import { MembershipsModule } from './memberships/memberships.module.js'
import { GoodsModule } from './goods/goods.module.js'
import { WorkItemsModule } from './work-items/work-items.module.js'
import { ReconciliationModule } from './reconciliation/reconciliation.module.js'
import { GovernanceModule } from './governance/governance.module.js'
import { PrivacyModule } from './privacy/privacy.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    AuditModule,
    ConfigurationModule,
    MembersModule,
    OrdersModule,
    OperationsModule,
    VenuesModule,
    TrainingModule,
    EventsModule,
    AllianceModule,
    GamesModule,
    ReferralsModule,
    DashboardModule,
    InventoryModule,
    ReportsModule,
    MembershipsModule,
    GoodsModule,
    WorkItemsModule,
    ReconciliationModule,
    GovernanceModule,
    PrivacyModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
