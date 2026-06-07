import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@proctira/ui/components': path.resolve(
        __dirname,
        '../../packages/ui/components/src',
      ),
      '@proctira/ui-components': path.resolve(
        __dirname,
        '../../packages/ui/components/src',
      ),
      '@proctira/ui-dashboards': path.resolve(
        __dirname,
        '../../packages/ui/dashboards/src',
      ),
      '@proctira/ui/dashboards': path.resolve(
        __dirname,
        '../../packages/ui/dashboards/src',
      ),
      '@proctira/ui/file-upload': path.resolve(
        __dirname,
        '../../packages/ui/file-upload/src',
      ),
    },
  },
});
