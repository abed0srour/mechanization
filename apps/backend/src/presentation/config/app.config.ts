import { join } from 'node:path';

/** Values that are policy rather than environment — kept out of .env so they are
 *  reviewed in code rather than drifting per-deployment. */
export const APP_CONFIG = {
  /** Path prefix every tenant-scoped route sits under. */
  apiPrefix: 'api/v1',
  tenantRoutePattern: 'api/v1/t/:tenantSlug/*',

  otp: {
    codeLength: 6,
    ttlSeconds: 300,
    /** Wrong guesses before the challenge is burned. */
    maxAttempts: 5,
    /** A citizen may not request a new code faster than this. */
    resendCooldownSeconds: 30,
    /** Codes per phone per hour, counted in Postgres since there is no Redis. */
    maxPerHour: 6,
    /** Attempt number at which delivery switches to the fallback route. */
    fallbackAfterAttempt: 2,
  },

  throttle: {
    /** Staff login — credential stuffing is the threat here. */
    staffLogin: { ttlSeconds: 60, limit: 5 },
    /** OTP request — SMS costs money and texts are a nuisance vector. */
    otpRequest: { ttlSeconds: 60, limit: 3 },
    /** Submission — generous; a citizen retrying a flaky upload is not an attack. */
    submission: { ttlSeconds: 60, limit: 10 },
  },

  documents: {
    signedUrlTtlSeconds: 300,
    maxFilesPerSubmission: 40,
  },

  cadastre: {
    maxFileSizeBytes: 15 * 1024 * 1024,
    /**
     * Where the static map layers the staff map fetches directly are written.
     * Computed from `cwd` rather than `__dirname`: both the ts-node CLI
     * importer (running from `src/`) and the compiled Nest app (running from
     * `dist/`) start with `cwd` at `apps/backend`, but `__dirname` sits at a
     * different depth in each, so anchoring on it here would break one of them.
     */
    mapAssetsDir: (tenantSlug: string) =>
      join(process.cwd(), '..', 'frontend', 'public', 'tenants', tenantSlug),
  },
} as const;
