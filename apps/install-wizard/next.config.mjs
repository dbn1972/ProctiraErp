import { buildSecurityHeaders } from './security-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Lint runs in the CI Lint job on changed files (same as apps/web); skip it inside
  // `next build` so Docker image builds do not need the type-aware ESLint toolchain.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // PRC-H009: security headers (CSP, no framing, nosniff, referrer policy).
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
