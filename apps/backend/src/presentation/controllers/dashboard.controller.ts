import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ReportingService } from '../../application/features/reporting/reporting.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';

@Controller('t/:tenantSlug/dashboard')
export class DashboardController {
  constructor(private readonly reporting: ReportingService) {}

  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR')
  @Get('counters')
  async counters() {
    return this.reporting.getDashboardCounters();
  }

  /** Marker coordinates for the MapLibre panel. */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR')
  @Get('map')
  async spatial() {
    return { features: await this.reporting.getSpatialData() };
  }

  /**
   * Bulk export, restricted to SUPER_ADMIN and AUDITOR: this is the one action
   * that moves every citizen's details out of the audited system and onto
   * someone's laptop. The export itself is recorded with its row count.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="registrations.csv"')
  async exportCsv(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentUser() user: SessionClaims,
    @Query('status') status?: string,
  ) {
    const csv = await this.reporting.exportCsv({
      tenantSlug,
      status,
      actor: { id: user.sub, role: user.role ?? '' },
    });

    // BOM so Excel opens Arabic names as UTF-8 rather than mojibake — without
    // it every export looks corrupted to the staff who requested it.
    return `﻿${csv}`;
  }
}
