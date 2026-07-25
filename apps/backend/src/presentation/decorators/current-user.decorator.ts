import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { SessionClaims } from '../../application/features/identity/identity.service';

/**
 * The verified session claims. Only ever populated by JwtAuthGuard, so a handler
 * receiving this has already had its token verified and its tenant matched.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionClaims => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) {
      // Reaching a handler without claims means the route was marked @Public
      // but still asks for a user — a wiring bug, not a client error.
      throw new Error('CurrentUser used on a route that is not behind JwtAuthGuard');
    }
    return request.user;
  },
);

/** The municipality resolved from the URL by TenantMiddleware. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.tenant) {
      throw new Error('CurrentTenant used on a route that is not behind TenantMiddleware');
    }
    return request.tenant;
  },
);
