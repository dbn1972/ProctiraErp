import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Component tests (*.test.tsx): Next's tsconfig uses jsx=preserve, so match
  // Next's automatic JSX runtime here so component tests can render TSX.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
