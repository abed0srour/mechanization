import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { TenantMismatchError } from '../../shared-kernel/domain/errors';
import { STAFF_JWT } from '../infrastructure/staff-jwt.strategy';
import { StaffJwtPayload } from '../application/login-staff.use-case';

/**
 * Verifies the JWT *and* that its tenant matches the municipality in the URL.
 * A valid token for municipality A must not work on municipality B's portal,
 * even though both are served by the same deployment.
 */
@Injectable()
export class StaffAuthGuard extends AuthGuard(STAFF_JWT) {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as StaffJwtPayload | undefined;
    const urlTenantId = request.tenant?.id;

    if (!user || !urlTenantId || user.tenantId !== urlTenantId) {
      throw new TenantMismatchError();
    }
    return true;
  }
}
