import createNextIntlPlugin from 'next-intl/plugin';

import { buildSecurityHeaders } from './security-headers.mjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@proctira/i18n', '@proctira/common'],
  // Lint runs in the CI Lint job; skip during `next build` so Docker image
  // builds do not require type-aware @typescript-eslint plugins in the image.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // PRC-L226: security headers (CSP, no framing, nosniff, referrer policy).
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
};

export default withNextIntl(nextConfig);
