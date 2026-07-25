import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from '../../application/features/audit/audit.service';
import { Roles } from '../decorators/roles.decorator';

/**
 * Reading the audit trail is itself a privileged act — it shows which staff
 * member opened which citizen's file — so it is SUPER_ADMIN and AUDITOR only.
 * A FIELD_INSPECTOR who could read it would be able to see how closely their own
 * work is being reviewed.
 */
@Controller('t/:tenantSlug/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get()
  async query(
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return this.audit.query({
      actorId,
      entityType,
      entityId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: Math.min(Number(limit) || 50, 200),
      offset: Number(offset) || 0,
    });
  }
}
