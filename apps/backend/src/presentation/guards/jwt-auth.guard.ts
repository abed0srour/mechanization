import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { SessionClaims } from '../../application/features/identity/identity.service';
import {
  TenantMismatchError,
  UnauthorizedError,
} from '../../application/common/exceptions';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * The single authentication guard, for citizens and staff alike.
 *
 * v1 had `StaffAuthGuard` and `CitizenAuthGuard` verifying two different token
 * formats issued by two different systems, which meant the tenant-match check
 * below existed twice — and a check written twice is one refactor away from
 * existing once. Here `kind` is the only branch, and it only decides *what the
 * token is allowed to reach*, never whether it was verified.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    let claims: SessionClaims;
    try {
      claims = this.jwt.verify<SessionClaims>(token);
    } catch {
      // Expired, wrong signature, malformed — all the same answer. Saying which
      // tells an attacker whether they have a real token to work with.
      throw new UnauthorizedError('Invalid or expired session');
    }

    /**
     * The check that matters most in a multi-tenant system: a perfectly valid
     * token for municipality A must not act on municipality B. The URL's tenant
     * was already resolved by TenantMiddleware; the token's is compared to it
     * here, before any handler runs.
     */
    const urlTenant = request.tenant?.slug;
    if (!urlTenant || claims.tenantSlug !== urlTenant) {
      throw new TenantMismatchError();
    }

    request.user = claims;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.header('authorization');
    if (!header) return undefined;

    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' ? value : undefined;
  }
}
