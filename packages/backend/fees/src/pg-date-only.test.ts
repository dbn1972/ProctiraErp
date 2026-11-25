/**
 * node-pg returns DATE columns as JS Dates at local midnight; fee structure
 * validFrom/validTo must still map to `YYYY-MM-DD` (instalment due dates parse it).
 */
import { describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { pgDateOnly } from './pg-fees-repository.js';

describe('pgDateOnly', () => {
  it('formats a node-pg DATE value (local-midnight Date) as YYYY-MM-DD', () => {
    expect(pgDateOnly(new Date(2026, 10, 25))).toBe('2026-11-25');
    expect(pgDateOnly(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
  it('passes through string dates and timestamps', () => {
    expect(pgDateOnly('2026-11-25')).toBe('2026-11-25');
    expect(pgDateOnly('2026-11-25T00:00:00.000Z')).toBe('2026-11-25');
  });
  it('yields a validFrom instalmentDueDate can parse', () => {
    const service = new FeesService(new InMemoryFeesRepository());
    const validFrom = pgDateOnly(new Date(2026, 10, 25));
    expect(service.instalmentDueDate({ validFrom }, 30)).toBe('2026-12-25');
  });
});
