/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Workspace packages ship TypeScript source — their `main` points at `src/` —
  // so Next has to compile them rather than treat them as prebuilt JS.
  // `@proctira/common`'s own `build` script emits nothing (`noEmit: true` in
  // `tsconfig.base.json`), so there is no `dist/` to fall back on.
  transpilePackages: ['@proctira/common', '@proctira/ui-components'],
  webpack: (config) => {
    // Shared packages keep explicit `.js` extensions in their source imports
    // (`import {…} from './config.js'`) so Node's ESM loader resolves them with
    // no build step. Webpack does not map `.js` → `.ts` by default, so mirror
    // TypeScript's `moduleResolution: bundler` here. `apps/web` has carried
    // this for a while; without the same mapping, the first `.js`-suffixed
    // import inside a shared package breaks this app's build alone.
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};
export default nextConfig;
