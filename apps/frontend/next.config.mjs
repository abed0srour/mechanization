import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */

/**
 * Vercel builds its own serverless output and rejects `standalone`; the Docker
 * runner depends on it. `VERCEL` is set by the platform on every build.
 */
const onVercel = Boolean(process.env.VERCEL);

/**
 * Response headers that do not vary per request.
 *
 * The Content-Security-Policy is deliberately *not* here: it carries a
 * per-request nonce and so has to be built in `middleware.ts`. Everything below
 * is constant, and a constant header belongs in the config where it can be read
 * without following a request through middleware.
 *
 * The portal had none of these. It renders every citizen's national ID number
 * and holds the staff bearer token in `localStorage`, which makes it the more
 * valuable of the two origins in this system — and the API, behind helmet, was
 * the only one with any.
 */
const SECURITY_HEADERS = [
  {
    /**
     * Two years, with subdomains. The portal is HTTPS-only in every deployment
     * and a downgrade would expose the session token in `localStorage` to
     * anyone on the path.
     */
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  {
    /**
     * `frame-ancestors 'none'` in the CSP is the modern form and is set in
     * middleware; this is the header older browsers read for the same thing.
     * Clickjacking a municipal dashboard means framing it under something that
     * persuades a clerk to click «تأكيد الدفع».
     */
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // A reference number in a URL must not travel to a third-party site in a
    // Referer header.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Nothing here uses any of them. Geolocation is the notable one: the map
    // takes coordinates from the cadastre, never from the clerk's device.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mechanization/shared-schemas'],
  eslint: { ignoreDuringBuilds: false },
  // `poweredByHeader` names the framework and version to anyone scanning.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  ...(onVercel
    ? {}
    : {
        // Traced standalone output, so the Docker runner ships only what the app
        // actually imports rather than the whole pnpm workspace.
        output: 'standalone',
        // The workspace root, not apps/frontend — otherwise tracing misses the
        // symlinked shared-schemas package.
        outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
      }),
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl(nextConfig);
