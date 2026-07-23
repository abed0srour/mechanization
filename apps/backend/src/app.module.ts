import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { SharedKernelModule } from './shared-kernel/shared-kernel.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantMiddleware } from './tenant/presentation/tenant.middleware';
import { StaffIdentityModule } from './staff-identity/staff-identity.module';
import { CitizenIdentityModule } from './citizen-identity/citizen-identity.module';
import { RegistrationModule } from './registration/registration.module';
import { AuditModule } from './audit/audit.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    SharedKernelModule,
    TenantModule,
    StaffIdentityModule,
    CitizenIdentityModule,
    RegistrationModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  /**
   * Every route under /t/:tenantSlug runs inside a resolved tenant scope.
   * Routes outside that prefix (health) deliberately have no tenant.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: 't/:tenantSlug*', method: RequestMethod.ALL });
  }
}
