/** @type {import('next').NextConfig} */

/**
 * Vercel builds its own serverless output and rejects `standalone`; the Docker
 * runner depends on it. `VERCEL` is set by the platform on every build.
 */
const onVercel = Boolean(process.env.VERCEL);

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mechanization/shared-schemas'],
  eslint: { ignoreDuringBuilds: false },
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

export default nextConfig;
