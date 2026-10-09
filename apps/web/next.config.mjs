import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';
import { buildSecurityHeaders } from './security-headers.mjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: {
    // Pre-existing lint warnings/errors are tracked separately; do not
    // block production builds on them.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      // PRC-H096: student photo upload goes through a server action as base64 (2 MB client
      // cap -> ~2.7 MB body). Next's 1 MB default rejected it before it reached the gateway.
      // PRC-M099: LMS assignment files (5 MB client cap -> ~6.7 MB base64 + envelope).
      bodySizeLimit: '8mb',
    },
  },
  transpilePackages: [
    '@proctira/i18n',
    '@proctira/tenant',
    '@proctira/common',
    '@proctira/ui-components',
    '@proctira/ui-dashboards',
    '@proctira/auth',
  ],
  // PRC-H009 / NEW-g1a_web-001: strict baseline security headers (CSP with
  // frame-ancestors 'none', X-Frame-Options DENY, nosniff, Referrer-Policy,
  // HSTS in prod) on every route, plus the stricter PRC-L024 no-referrer
  // override on auth screens / auth route handlers (applied after the baseline
  // so it wins for the Referrer-Policy key on those paths).
  async headers() {
    const noReferrer = [{ key: 'Referrer-Policy', value: 'no-referrer' }];
    return [
      { source: '/:path*', headers: buildSecurityHeaders() },
      ...[
        '/login',
        '/mfa',
        '/mfa-setup',
        '/forgot-password',
        '/reset-password',
        '/api/auth/:path*',
      ].map((source) => ({ source, headers: noReferrer })),
    ];
  },
  webpack: (config) => {
    // The shared `@proctira/auth` package keeps explicit `.js`
    // extensions in its source imports (e.g. `import {…} from
    // './config.js'`) so Node's ESM loader can resolve them at
    // runtime without a build step. Webpack's default extension
    // resolution does NOT map `.js` → `.ts`, so we mirror
    // TypeScript's `moduleResolution: bundler` behavior here. This
    // keeps the same `import` specifier valid in Node, Vitest, and
    // Webpack without forcing a separate bundling step for shared
    // packages.
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
