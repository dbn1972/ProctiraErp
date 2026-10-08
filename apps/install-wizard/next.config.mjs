import { buildSecurityHeaders } from './security-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // PRC-H009: lint failures break the build. ESLint runs during `next build`
  // (no ignoreDuringBuilds) in addition to the CI Lint job.
  // PRC-H009: security headers (CSP, no framing, nosniff, referrer policy).
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
