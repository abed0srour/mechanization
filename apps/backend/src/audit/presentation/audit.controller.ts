import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { StaffAuthGuard } from '../../staff-identity/presentation/staff-auth.guard';
import { Roles, RolesGuard } from '../../staff-identity/presentation/roles.decorator';
import { AUDIT_REPOSITORY, AuditRepository } from '../domain/audit-entry';

@Controller('t/:tenantSlug/staff/audit')
@UseGuards(StaffAuthGuard, RolesGuard)
export class AuditController {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  /** Only SUPER_ADMIN — staff must not be able to inspect or shape their own trail. */
  @Roles('SUPER_ADMIN')
  @Get()
  async list(
    @Req() req: Request,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
  ) {
    const result = await this.audit.list({
      tenantId: req.tenant!.id,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(200, Math.max(1, Number(pageSize) || 50)),
      action,
      actorId,
    });
    return {
      items: result.items,
      total: result.total,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    };
  }
}
