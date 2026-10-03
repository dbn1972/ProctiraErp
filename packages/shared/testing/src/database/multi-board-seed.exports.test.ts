/**
 * PRC-L497: the in-memory multi-board fixture is part of the public package API.
 */
import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import * as db from './index.js';

describe('multi-board seed exports (PRC-L497)', () => {
  it('exposes the fixture from the package root and the ./database entry', () => {
    expect(typeof root.seedMultiBoardSchools).toBe('function');
    expect(typeof root.assertMultiBoardSeedInvariants).toBe('function');
    expect(root.DEFAULT_MULTI_BOARD_PROFILE.length).toBe(3);
    expect(db.seedMultiBoardSchools).toBe(root.seedMultiBoardSchools);
  });

  it('stays an in-memory fixture: result carries data only, no persistence handle', () => {
    const r = root.seedMultiBoardSchools({ studentsPerSchool: 2, staffPerSchool: 1 });
    expect(r.totals.enrollmentCount).toBe(12);
    expect(Object.keys(r).sort()).toEqual(['areas', 'boards', 'schools', 'tenant', 'totals']);
  });
});
