/**
 * PRC-M424 — CDC runner config validation.
 */
import { describe, it, expect } from 'vitest';

import { loadCDCConfig, requirePositiveInt } from './cdc-config.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('loadCDCConfig (PRC-M424)', () => {
  it('requires an explicit uuid tenant id (no "default" fallback)', () => {
    expect(() => loadCDCConfig({ NODE_ENV: 'development' })).toThrow(/CDC_TENANT_ID is required/);
    expect(() => loadCDCConfig({ NODE_ENV: 'development', CDC_TENANT_ID: 'default' })).toThrow(
      /must be a tenant uuid/,
    );
  });

  it('rejects an unknown conflict policy', () => {
    expect(() =>
      loadCDCConfig({
        NODE_ENV: 'development',
        CDC_TENANT_ID: UUID,
        CDC_CONFLICT_RESOLUTION: 'drop_everything',
      }),
    ).toThrow(/CDC_CONFLICT_RESOLUTION/);
  });

  it('defaults to the non-destructive target_wins policy', () => {
    const cfg = loadCDCConfig({ NODE_ENV: 'development', CDC_TENANT_ID: UUID });
    expect(cfg.conflictResolution).toBe('target_wins');
    expect(cfg.tenantId).toBe(UUID);
  });

  it('fails fast when KAFKA_BROKERS is missing outside development', () => {
    expect(() => loadCDCConfig({ NODE_ENV: 'production', CDC_TENANT_ID: UUID })).toThrow(
      /KAFKA_BROKERS is required/,
    );
    // Dev is allowed to default to localhost.
    expect(loadCDCConfig({ NODE_ENV: 'development', CDC_TENANT_ID: UUID }).kafkaBrokers).toEqual([
      'localhost:9092',
    ]);
  });

  it('requirePositiveInt rejects NaN / non-positive', () => {
    expect(requirePositiveInt('X', undefined, 5)).toBe(5);
    expect(requirePositiveInt('X', '10', 5)).toBe(10);
    expect(() => requirePositiveInt('X', 'abc', 5)).toThrow(/positive integer/);
    expect(() => requirePositiveInt('X', '0', 5)).toThrow(/positive integer/);
  });
});
