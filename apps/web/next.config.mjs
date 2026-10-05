import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';

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
  // PRC-L024: auth screens and auth route handlers never leak their URL
  // (reset tokens, returnTo) to third parties via the Referer header.
  async headers() {
    const noReferrer = [{ key: 'Referrer-Policy', value: 'no-referrer' }];
    return [
      '/login',
      '/mfa',
      '/mfa-setup',
      '/forgot-password',
      '/reset-password',
      '/api/auth/:path*',
    ].map((source) => ({ source, headers: noReferrer }));
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
