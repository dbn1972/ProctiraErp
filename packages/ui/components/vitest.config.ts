import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // PRC-L192: coverage is always collected so `turbo run test` (CI) fails when it
    // drops below the ratcheted floor. Raise floors as tests are added; never lower them.
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/test-setup.ts', 'src/**/index.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { statements: 56, branches: 75, functions: 53, lines: 56 },
    },
  },
});
