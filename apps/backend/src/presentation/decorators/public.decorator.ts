import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of JwtAuthGuard.
 *
 * Authentication is on by default and removed explicitly, rather than added
 * route by route: forgetting this decorator makes an endpoint unreachable, which
 * someone reports immediately. The reverse mistake exposes citizen data quietly.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
