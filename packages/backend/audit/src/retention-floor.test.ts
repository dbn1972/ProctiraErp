/**
 * Audit retention floor — API schema contract (PRC-L256, PRC-L295)
 *
 * The platform floor for audit retention is 12 months. The design (topic 5,
 * "Retention floor (L256, L295)") requires the floor to be enforced at three
 * layers so a tenant cannot lower it: the DB CHECK
 * (`db/sql/243_audit_retention_floor.sql`, already present), the server service
 * floor (`AuditService.setRetentionConfig`, already present) AND the API minimum.
 *
 * The API request schema (`SetRetentionConfigSchema`) is the contract exposed to
 * clients and to generated API docs. On the base source it advertised
 * `minimum: 1`, so the schema layer accepted a below-floor value (11 months) and
 * the rejection happened only deeper in the service. This test pins the API
 * minimum to the 12-month floor: the schema itself must reject a below-floor
 * value, matching the DB CHECK and the web UI minimum.
 *
 * Failing-first (PRC-L256, PRC-L295): on the base source the schema minimum is 1,
 * so `validate(SetRetentionConfigSchema, { retentionMonths: 11, ... })` succeeds
 * and this suite fails. After the schema minimum is raised to 12 it rejects 11
 * with a `minimum` rule on `retentionMonths`.
 */
import { validate } from '@proctira/validation';
import { describe, it, expect } from 'vitest';

import { SetRetentionConfigSchema } from './schemas.js';

const AUDIT_RETENTION_FLOOR_MONTHS = 12;

describe('audit retention floor — SetRetentionConfigSchema (PRC-L256/L295)', () => {
  it('rejects a below-floor retention period (11 months) at the schema layer', () => {
    const result = validate(SetRetentionConfigSchema, {
      retentionMonths: AUDIT_RETENTION_FLOOR_MONTHS - 1,
      archivalEnabled: false,
    });

    expect(result.success).toBe(false);
    if (result.success) return; // narrow for TS; assertion above already failed
    const retentionError = result.errors.find((e) => e.field === 'retentionMonths');
    expect(retentionError).toBeDefined();
    expect(retentionError?.rule).toBe('minimum');
  });

  it('rejects every value strictly below the 12-month floor', () => {
    for (let months = 1; months < AUDIT_RETENTION_FLOOR_MONTHS; months += 1) {
      const result = validate(SetRetentionConfigSchema, {
        retentionMonths: months,
        archivalEnabled: false,
      });
      expect(result.success, `retentionMonths=${months} must be rejected`).toBe(false);
    }
  });

  it('accepts the floor value (12 months) and values above it', () => {
    for (const months of [AUDIT_RETENTION_FLOOR_MONTHS, 24, 84, 120]) {
      const result = validate(SetRetentionConfigSchema, {
        retentionMonths: months,
        archivalEnabled: false,
      });
      expect(result.success, `retentionMonths=${months} must be accepted`).toBe(true);
    }
  });

  it('still rejects values above the 120-month maximum', () => {
    const result = validate(SetRetentionConfigSchema, {
      retentionMonths: 121,
      archivalEnabled: false,
    });
    expect(result.success).toBe(false);
  });
});
