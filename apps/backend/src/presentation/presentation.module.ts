import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApplicationModule } from '../application/application.module';
import { AuditController } from './controllers/audit.controller';
import { AuthController } from './controllers/auth.controller';
import { CadastreController } from './controllers/cadastre.controller';
import { CitizenController } from './controllers/citizen.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { DocumentController } from './controllers/document.controller';
import { HealthController } from './controllers/health.controller';
import { RegistrationController } from './controllers/registration.controller';
import { TenantController } from './controllers/tenant.controller';
import { ZonesController } from './controllers/zones.controller';
import { DomainExceptionFilter } from './filters/domain-exception.filter';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { TenantMiddleware } from './middleware/tenant.middleware';

@Module({
  imports: [ApplicationModule],
  controllers: [
    HealthController,
    TenantController,
    AuthController,
    RegistrationController,
    DocumentController,
    AuditController,
    DashboardController,
    CitizenController,
    CadastreController,
    ZonesController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    /**
     * Both guards are global and ordered: authenticate, then authorise. Opting
     * out is explicit (`@Public()`), so a new controller is protected by
     * default — the failure mode of forgetting is a locked door, not an open one.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class PresentationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    /**
     * Tenant resolution runs only under `/t/:tenantSlug`. Health checks sit
     * outside it deliberately: they must answer even when the registry is down.
     *
     * The wildcard is Express 4 syntax (`*`, not `*path`): under
     * path-to-regexp 0.1.x a named wildcard is read as `(.*)` followed by the
     * literal text, so `*path` silently matches nothing and every route below
     * runs with no tenant scope at all.
     */
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: 't/:tenantSlug/*', method: RequestMethod.ALL });
  }
}
