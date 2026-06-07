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
  transpilePackages: [
    '@proctira/i18n',
    '@proctira/tenant',
    '@proctira/common',
    '@proctira/ui-components',
    '@proctira/ui-dashboards',
    '@proctira/auth',
  ],
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
