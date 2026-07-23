import { Controller, Get, Param } from '@nestjs/common';
import { GetTenantConfigUseCase } from '../application/get-tenant-config.use-case';

@Controller('t/:tenantSlug')
export class TenantController {
  constructor(private readonly getTenantConfig: GetTenantConfigUseCase) {}

  /** Public: lets the citizen wizard brand itself and know which fields to show. */
  @Get('config')
  async config(@Param('tenantSlug') tenantSlug: string) {
    return this.getTenantConfig.execute(tenantSlug);
  }
}
