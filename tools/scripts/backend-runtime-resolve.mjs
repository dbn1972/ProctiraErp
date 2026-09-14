/**
 * Register a Node ESM resolve hook that falls back across the pnpm workspace.
 *
 * Production entry bundles live under an app/service package directory. After
 * esbuild inlines `@proctira/*` sources, bare imports such as `prom-client` or
 * `@prisma/client` must still resolve. Those packages are often declared only
 * on a transitive workspace package, so Node's default walk from the bundle
 * path fails under pnpm's strict layout.
 *
 * Usage (production CMD):
 *   node --import /app/tools/scripts/backend-runtime-resolve.mjs --enable-source-maps dist/server.js
 *
 * This is not tsx — the application entry remains compiled JavaScript (W1-ARCH-09).
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./backend-runtime-resolve-hook.mjs', import.meta.url);
