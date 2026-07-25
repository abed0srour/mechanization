import type { SessionClaims } from '../application/features/identity/identity.service';

/**
 * Request augmentations, declared once.
 *
 * These were previously repeated in the middleware and guard that set each
 * field. Three copies of the same augmentation compile, but they drift — and a
 * guard reading `request.tenant` needs the same shape the middleware wrote,
 * enforced by the compiler rather than by memory.
 */
declare global {
  namespace Express {
    interface Request {
      /** Set by TenantMiddleware, before any guard runs. */
      tenant?: {
        id: string;
        slug: string;
        schemaName: string;
        adminPathSegment: string;
      };

      /** Set by JwtAuthGuard once the token is verified and its tenant matched. */
      user?: SessionClaims;

      /** Set by CorrelationIdMiddleware on every request. */
      correlationId?: string;
    }
  }
}

export {};
