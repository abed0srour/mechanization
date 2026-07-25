/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mechanization/shared-schemas'],
  eslint: { ignoreDuringBuilds: false },
  // Traced standalone output, so the Docker runner ships only what the app
  // actually imports rather than the whole pnpm workspace.
  output: 'standalone',
  // The workspace root, not apps/frontend — otherwise tracing misses the
  // symlinked shared-schemas package.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default nextConfig;
