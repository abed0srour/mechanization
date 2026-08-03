import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  adminCreateCitizenSchema,
  adminUpdateCitizenSchema,
} from '@mechanization/shared-schemas';
import type {
  AdminCreateCitizen,
  AdminUpdateCitizen,
} from '@mechanization/shared-schemas';
import { CitizensService } from '../../application/features/citizens/citizens.service';
import { ReportingService } from '../../application/features/reporting/reporting.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { NotFoundError } from '../../application/common/exceptions';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';

/**
 * Staff-facing citizen registry — read, create, correct, remove.
 *
 * Mounted under the tenant path like everything else, so `TenantMiddleware`
 * resolves the municipality and `JwtAuthGuard` rejects a token issued for a
 * different one before this controller runs. There is deliberately no
 * un-scoped `/citizens/:id` route: an id alone would not say which
 * municipality's schema to read, and the tenant boundary in this system is the
 * database connection rather than a WHERE clause.
 *
 * Read is open to every staff role — an inspector standing at a property needs
 * to know who filed for it. Writing is not: since the public wizard was
 * removed from the landing page, creating a citizen here is the act that puts
 * someone on the municipality's registry, and it carries their identity
 * document. That belongs to the roles accountable for the register, so the
 * write routes are SUPER_ADMIN and FIELD_INSPECTOR (the two who already move
 * claims through review); AUDITOR keeps the read-only remit its name implies.
 */
@Controller('t/:tenantSlug/citizens')
export class CitizenController {
  constructor(
    private readonly citizens: CitizensService,
    private readonly reporting: ReportingService,
  ) {}

  /**
   * The registry table: every citizen with their registration summary and
   * their fee standing. `search` matches name, phone, رقم مرجعي or document
   * number — the four things a clerk has in front of them.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR')
  @Get()
  async list(
    @Query('search') search?: string,
    @Query('limit') limit = '200',
    @Query('offset') offset = '0',
  ) {
    return this.citizens.list({
      search,
      limit: Number(limit) || 200,
      offset: Number(offset) || 0,
    });
  }

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

  /**
   * The citizen's record shaped back into the form that edits it — the same
   * three sections `PATCH` expects, so the edit page loads and posts the same
   * object rather than mapping between two shapes.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR')
  @Get(':id/form')
  async getEditable(@Param('id') id: string) {
    return this.citizens.getEditable(id);
  }

  /** A clerk filing a citizen and their first registration, from paper. */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR')
  @Post()
  async create(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(adminCreateCitizenSchema)) payload: AdminCreateCitizen,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.citizens.create({
      tenantSlug,
      payload,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /** A clerk correcting a citizen already on file. */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR')
  @Patch(':id')
  async update(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminUpdateCitizenSchema)) payload: AdminUpdateCitizen,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.citizens.update({
      tenantSlug,
      citizenId: id,
      payload,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /**
   * Soft delete and its undo. A deactivated citizen keeps every row they own
   * and is simply skipped by the fee biller — which is what an inspector
   * wants for someone who has moved away, as against erasing them.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR')
  @Patch(':id/active')
  async setActive(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.citizens.setActive({
      tenantSlug,
      citizenId: id,
      isActive: isActive !== false,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /**
   * Permanent, and cascades to everything the citizen owns. SUPER_ADMIN only:
   * this erases identity data and registration history in one call, which is
   * not a decision to leave with the role that exists to inspect properties.
   * The service additionally refuses it for anyone with a settled payment.
   */
  @Roles('SUPER_ADMIN')
  @Delete(':id')
  async remove(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.citizens.remove({
      tenantSlug,
      citizenId: id,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }
}
