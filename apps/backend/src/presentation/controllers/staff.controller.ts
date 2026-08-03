import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createStaffUserSchema,
  staffActiveSchema,
  updateStaffUserSchema,
} from '@mechanization/shared-schemas';
import { StaffService } from '../../application/features/staff/staff.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';
import type { StaffRole } from '../../domain/entities/user.entity';

/**
 * Staff account administration.
 *
 * SUPER_ADMIN at the controller, on every route rather than per-method:
 * creating accounts *is* the privilege escalation path in this system, and an
 * AUDITOR reading the list would also be reading the shape of who can approve
 * what. No password hash ever leaves here — the list projection has no such
 * field to accidentally include.
 */
@Roles('SUPER_ADMIN')
@Controller('t/:tenantSlug/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** Every staff account, including deactivated ones. */
  @Get()
  async list() {
    return { items: await this.staff.list() };
  }

  @Post()
  async create(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(createStaffUserSchema))
    body: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: StaffRole;
    },
    @CurrentUser() user: SessionClaims,
  ) {
    return this.staff.create({
      tenantSlug,
      ...body,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  @Patch(':id')
  async update(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStaffUserSchema))
    body: {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      role?: StaffRole;
    },
    @CurrentUser() user: SessionClaims,
  ) {
    await this.staff.update({
      tenantSlug,
      id,
      ...body,
      actor: { id: user.sub, role: user.role ?? '' },
    });
    return { updated: true };
  }

  /** Soft delete, and its undo — one route because they are one decision. */
  @Patch(':id/active')
  async setActive(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(staffActiveSchema)) body: { isActive: boolean },
    @CurrentUser() user: SessionClaims,
  ) {
    await this.staff.setActive({
      tenantSlug,
      id,
      isActive: body.isActive,
      actor: { id: user.sub, role: user.role ?? '' },
    });
    return { isActive: body.isActive };
  }

  /** Permanent, and refused for any account that has already acted. */
  @Delete(':id')
  async remove(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentUser() user: SessionClaims,
  ) {
    await this.staff.remove({
      tenantSlug,
      id,
      actor: { id: user.sub, role: user.role ?? '' },
    });
    return { deleted: true };
  }
}
