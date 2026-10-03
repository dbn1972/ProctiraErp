import { buildSecurityHeaders } from './security-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // PRC-H009: `next build` lints (no ignoreDuringBuilds) so a lint error fails the build.
  // PRC-H009: security headers (CSP, no framing, nosniff, referrer policy).
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
