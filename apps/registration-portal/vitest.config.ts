import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Match Next's automatic JSX runtime so component tests can render TSX.
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
