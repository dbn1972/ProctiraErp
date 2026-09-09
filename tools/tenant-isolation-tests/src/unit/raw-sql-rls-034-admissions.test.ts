/**
 * G-906 — RLS contract for db/sql/034_admissions_crm_schema.sql.
 * Kept as a dedicated file so Wave 9 peer-stream SQL (031–033) cannot
 * fail collection of this slice.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TABLES = [
  'admission_enquiries',
  'enquiry_followups',
  'seat_matrix',
  'merit_lists',
  'merit_list_entries',
  'admission_offers',
] as const;

function loadSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/034_admissions_crm_schema.sql'),
    join(process.cwd(), 'db/sql/034_admissions_crm_schema.sql'),
    join(process.cwd(), '../../db/sql/034_admissions_crm_schema.sql'),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/sql/034_admissions_crm_schema.sql');
}

describe('Wave 9 admissions CRM raw-SQL RLS (034_admissions_crm_schema.sql)', () => {
  const sql = loadSql();

  it('creates enquiry/seat/merit/offer tables with tenant_id and forces RLS on each', () => {
    for (const table of TABLES) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY tenant_isolation ON ${table}[\\s\\S]*?USING \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)[\\s\\S]*?WITH CHECK \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)`,
        ),
      );
    }
  });
});
