/**
 * PRC-M422 — unmapped staging table inventory + honest summary wording.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';

import { findUnmappedStagingTables, listStagingTables } from './inventory.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('findUnmappedStagingTables (PRC-M422)', () => {
  it('reports staging tables with no mapping', async () => {
    const mapped = TABLE_MAPPINGS[0]!.sourceTable;
    const query = vi.fn(async () => ({
      rows: [{ table_name: mapped }, { table_name: 'fees' }, { table_name: 'guardians' }],
    }));
    const inv = await findUnmappedStagingTables({ query } as never, 'migration_staging');
    expect(inv.unmappedTables).toContain('fees');
    expect(inv.unmappedTables).toContain('guardians');
    expect(inv.unmappedTables).not.toContain(mapped);
  });

  it('listStagingTables queries only BASE TABLE rows in the schema', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await listStagingTables({ query } as never, 'migration_staging');
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("table_type = 'BASE TABLE'");
    expect(params).toEqual(['migration_staging']);
  });
});

describe('run-full-migration summary (PRC-M422)', () => {
  it('no longer claims unqualified "Migration completed successfully!"', () => {
    const src = readFileSync(join(here, 'run-full-migration.ts'), 'utf8');
    expect(src).not.toContain('Migration completed successfully!');
    expect(src).toContain('Mapped tables migrated successfully.');
    expect(src).toContain('reportUnmappedTables');
  });

  it('PRC-M557: offers a flagged, opt-in staging purge (fail-closed by default)', () => {
    const src = readFileSync(join(here, 'run-full-migration.ts'), 'utf8');
    expect(src).toContain('MIGRATION_PURGE_STAGING');
    expect(src).toContain('maybePurgeStaging');
    // Default is retain (opt-in), not auto-drop.
    expect(src).toContain('Staging schema retained');
  });
});
