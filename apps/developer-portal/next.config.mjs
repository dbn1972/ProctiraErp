import createNextIntlPlugin from 'next-intl/plugin';

import { buildSecurityHeaders } from './security-headers.mjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@proctira/i18n', '@proctira/tenant', '@proctira/common'],
  // PRC-H009: security headers (CSP, no framing, nosniff, referrer policy).
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
};

export default withNextIntl(nextConfig);
