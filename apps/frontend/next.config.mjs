/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mechanization/shared-schemas'],
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
