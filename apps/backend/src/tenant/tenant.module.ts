import { Module } from '@nestjs/common';
import { TENANT_REPOSITORY } from './domain/tenant.repository';
import { GetTenantConfigUseCase } from './application/get-tenant-config.use-case';
import { ResolveTenantUseCase } from './application/resolve-tenant.use-case';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';
import { TenantController } from './presentation/tenant.controller';
import { TenantMiddleware } from './presentation/tenant.middleware';

@Module({
  controllers: [TenantController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    ResolveTenantUseCase,
    GetTenantConfigUseCase,
    TenantMiddleware,
  ],
  exports: [ResolveTenantUseCase, TenantMiddleware, TENANT_REPOSITORY],
})
export class TenantModule {}
