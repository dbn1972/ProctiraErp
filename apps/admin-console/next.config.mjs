/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Workspace packages ship TypeScript source (`main` points at `src/`), so
  // Next has to compile them rather than treat them as prebuilt JS.
  transpilePackages: ['@proctira/common'],
};
export default nextConfig;
