import createNextIntlPlugin from 'next-intl/plugin';

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
};

export default withNextIntl(nextConfig);
