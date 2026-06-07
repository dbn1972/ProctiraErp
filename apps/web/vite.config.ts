import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { compression } from 'vite-plugin-compression2';
import path from 'path';

/**
 * Vite configuration for the SPA delivery mode of the ProctiraERP web app.
 *
 * Key feature: manualChunks splits each feature module into its own async
 * chunk, satisfying Requirement 39 (lazy-loading expectations) — unused
 * features do not contribute to the initial bundle size.
 *
 * Pre-compression (Requirement 39, task 55.6): every text-like artifact
 * over 1 KiB is emitted alongside a `.gz` (gzip) and a `.br` (brotli)
 * sibling. The API_Gateway / CDN serves the variant matching the
 * client's `Accept-Encoding` header.
 */

// File extensions that benefit from text compression. Already-compressed
// formats (jpg, png, woff2, etc.) are intentionally skipped.
const COMPRESSIBLE_PATTERN = /\.(js|mjs|cjs|css|html|svg|json|wasm|map|txt|xml)$/i;

// Skip artifacts smaller than 1 KiB — the wire-overhead of the encoding
// header outweighs any savings on tiny payloads.
const COMPRESSION_THRESHOLD_BYTES = 1024;

export default defineConfig({
  plugins: [
    react(),
    // Bundle analysis: generates an HTML report showing gzipped chunk sizes.
    // Activated on production builds when ANALYZE=true (Requirement 39).
    ...(process.env.ANALYZE === 'true'
      ? [
          visualizer({
            filename: 'dist/bundle-analysis.html',
            open: false,
            gzipSize: true,
            template: 'treemap',
          }),
        ]
      : []),
    // Pre-compression: emit `.gz` and `.br` siblings of compressible
    // artifacts. The CDN / API_Gateway selects the right encoding
    // based on `Accept-Encoding`. See `apps/api-gateway/src/plugins/
    // static-assets.ts` for the negotiation logic.
    compression({
      include: COMPRESSIBLE_PATTERN,
      threshold: COMPRESSION_THRESHOLD_BYTES,
      deleteOriginalAssets: false,
      algorithms: ['gzip', 'brotliCompress'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Vendor chunks — split large dependencies
          if (id.includes('node_modules')) {
            if (id.includes('react-router') || id.includes('@remix-run')) {
              return 'vendor-router';
            }
            if (id.includes('react-dom')) {
              return 'vendor-react-dom';
            }
            if (id.includes('react')) {
              return 'vendor-react';
            }
            if (id.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('recharts') || id.includes('d3')) {
              return 'vendor-charts';
            }
            return 'vendor';
          }

          // Feature module chunks — each feature gets its own async chunk
          const featureMatch = id.match(
            /src\/features\/([\w-]+)\//
          );
          if (featureMatch) {
            return `feature-${featureMatch[1]}`;
          }

          return undefined;
        },
      },
    },
    // Target modern browsers for smaller output
    target: 'es2020',
    // Enable source maps for debugging
    sourcemap: true,
    // Chunk size warning at 250KB (Requirement 39: 500KB gzip budget)
    chunkSizeWarningLimit: 250,
  },
  // Test configuration (shared with vitest.config.ts)
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
