import { Controller, Get, Param } from '@nestjs/common';
import { ReportingService } from '../../application/features/reporting/reporting.service';
import { NotFoundError } from '../../application/common/exceptions';
import { Roles } from '../decorators/roles.decorator';

/**
 * Staff-facing citizen profiles.
 *
 * Mounted under the tenant path like everything else, so `TenantMiddleware`
 * resolves the municipality and `JwtAuthGuard` rejects a token issued for a
 * different one before this controller runs. There is deliberately no
 * un-scoped `/citizens/:id` route: an id alone would not say which
 * municipality's schema to read, and the tenant boundary in this system is the
 * database connection rather than a WHERE clause.
 */
@Controller('t/:tenantSlug/citizens')
export class CitizenController {
  constructor(private readonly reporting: ReportingService) {}

  /**
   * FIELD_INSPECTOR is included: an inspector standing at the property needs
   * to know who filed for it. The identity numbers on this response are the
   * reason the route is role-gated at all.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR')
  @Get(':id')
  async getById(@Param('id') id: string) {
    const citizen = await this.reporting.getCitizenProfile(id);
    if (!citizen) throw new NotFoundError('Citizen', id);
    return citizen;
  }
}
