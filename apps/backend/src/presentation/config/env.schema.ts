import { z } from 'zod';

/**
 * Boot fails on a missing or malformed secret rather than surfacing it as a 500
 * on the first request that needs it — a JWT secret that is silently `undefined`
 * produces tokens anyone can forge.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),

    /** Pooled connection (pgbouncer) for application queries. */
    DATABASE_URL: z.string().url(),
    /** Session-mode connection — migrations and DDL only. */
    DIRECT_URL: z.string().url(),

    SUPABASE_URL: z.string().url(),
    /** Server-side only. Never sent to a browser; storage access, not auth. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default('documents'),

    /**
     * One secret for both citizen and staff tokens — v2 unified the two auth
     * systems precisely so there is one verification path to get right.
     */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_STAFF_TTL: z.string().default('12h'),
    /** Issued instead of JWT_STAFF_TTL when a staff member checks "تذكّرني على هذا الجهاز". */
    JWT_STAFF_REMEMBER_TTL: z.string().default('30d'),
    JWT_CITIZEN_TTL: z.string().default('7d'),

    SMS_PROVIDER_API_KEY: z.string().optional(),
    /** Second delivery route. See the OTP fallback requirement below. */
    SMS_PROVIDER_FALLBACK_API_KEY: z.string().optional(),

    /**
     * Citizen one-time-password verification.
     *
     * Off means a phone number alone signs someone in. That is a development
     * convenience while no SMS provider is wired up — it is refused in
     * production below, because the records behind this login include national
     * ID numbers, home addresses and refugee status.
     *
     * Anything unrecognised parses as *enabled*: a typo in an environment
     * variable must not silently unlock the citizen portal.
     */
    OTP_ENABLED: z
      .string()
      .default('true')
      .transform((value) => !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())),

    /**
     * Optional: the dashboard cache runs in read-through mode when unset (every
     * read falls straight to Postgres), so a dev environment without Redis
     * still works — it just does not get the cached fast path.
     */
    REDIS_URL: z.string().url().optional(),
    DASHBOARD_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    /**
     * Tenant registry rows change only at onboarding time, but resolving one is
     * on the hot path of every tenant-scoped request (TenantMiddleware runs it
     * first) — so this is cached far longer than the dashboard data.
     */
    TENANT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    /**
     * Short on purpose: the audit trail is appended to on nearly every action in
     * the system (every login included), so this exists to absorb repeated reads
     * of the same page within a few seconds — not to survive writes without
     * looking stale, which a historical log tolerates fine.
     */
    AUDIT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(20),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    /**
     * The one guardrail on the flag above. Citizen records hold identity
     * document numbers, home coordinates and residency status; without OTP the
     * only thing standing between those and anyone at all is knowing a phone
     * number, which is not a secret. A deploy that reaches production with this
     * off is a mistake, and boot is the last place it can still be caught.
     */
    if (!env.OTP_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_ENABLED'],
        message:
          'OTP cannot be disabled in production — a phone number alone would open a citizen record',
      });
    }

    /**
     * Lebanese SMS delivery fails often enough that a single provider is a
     * single point of failure on the login path — and the people locked out are
     * exactly the ones this system exists to serve. Production refuses to start
     * without a second route configured.
     */
    if (!env.SMS_PROVIDER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER_API_KEY'],
        message: 'An SMS provider is required in production — citizen login depends on it',
      });
    }
    if (!env.SMS_PROVIDER_FALLBACK_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER_FALLBACK_API_KEY'],
        message:
          'A fallback SMS route is required in production (see docs/open-decisions.md). ' +
          'Set it, or deliberately set it equal to the primary key to accept the risk.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses the environment or throws with every problem listed at once —
 * a boot that fails on one missing variable at a time wastes a deploy each.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
