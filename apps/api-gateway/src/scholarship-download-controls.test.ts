/**
 * PRC-L344: gateway scholarship download controls — Redis-backed replay guard selection. The
 * per-download audit row is covered in the scholarship package (document-download-audit.test.ts).
 */
import { RedisDownloadTokenReplayGuard } from '@proctira/backend-scholarship';
import { describe, expect, it } from 'vitest';

import { createScholarshipDownloadReplayGuard } from './scholarship-download-controls.js';

describe('scholarship download controls (PRC-L344)', () => {
  it('uses Redis when injected and refuses the per-replica guard in production', () => {
    const redis = { set: async () => 'OK' as const };
    expect(createScholarshipDownloadReplayGuard({ redis, NODE_ENV: 'production' })).toBeInstanceOf(
      RedisDownloadTokenReplayGuard,
    );
    expect(() => createScholarshipDownloadReplayGuard({ NODE_ENV: 'production' })).toThrow(
      /REDIS_URL/,
    );
  });
});
