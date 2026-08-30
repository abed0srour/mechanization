import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ReportingService } from '../../application/features/reporting/reporting.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';

@Controller('t/:tenantSlug/dashboard')
export class DashboardController {
  constructor(private readonly reporting: ReportingService) {}

  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR', 'COLLECTOR', 'ACCOUNTANT', 'ADMINISTRATIVE_OFFICER')
  @Get('counters')
  async counters() {
    return this.reporting.getDashboardCounters();
  }

  /**
   * Everything the analytics dashboard plots, in one payload.
   *
   * Deliberately one endpoint rather than one per widget: the KPI tiles and
   * the charts have to agree, and separately-cached fetches guarantee a window
   * where a rate computed from one response contradicts a total from another.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR', 'ACCOUNTANT', 'ADMINISTRATIVE_OFFICER')
  @Get('analytics')
  async analytics() {
    return this.reporting.getAnalytics();
  }

  /** Marker coordinates for the MapLibre panel. */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR', 'ACCOUNTANT', 'ADMINISTRATIVE_OFFICER')
  @Get('map')
  async spatial() {
    return { features: await this.reporting.getSpatialData() };
  }

  /**
   * Parcels that actually have citizen registrations, each with everyone
   * attached to it.
   *
   * The fullscreen map draws the whole cadastre from a static GeoJSON and
   * places an interactive marker only on what this returns — so a dot always
   * means there is a citizen record behind it.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR', 'ACCOUNTANT', 'ADMINISTRATIVE_OFFICER')
  @Get('map/parcels')
  async registeredParcels() {
    return { parcels: await this.reporting.getRegisteredParcels() };
  }

  /**
   * Bulk export, restricted to SUPER_ADMIN, AUDITOR, and ACCOUNTANT.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'ACCOUNTANT')
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="registrations.csv"')
  async exportCsv(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentUser() user: SessionClaims,
  ) {
    // The `status` filter is gone with the review workflow — there is one
    // export now, of everything on file.
    const csv = await this.reporting.exportCsv({
      tenantSlug,
      actor: { id: user.sub, role: user.role ?? '' },
    });

    // BOM so Excel opens Arabic names as UTF-8 rather than mojibake — without
    // it every export looks corrupted to the staff who requested it.
    return `﻿${csv}`;
  }
}
