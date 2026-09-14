/**
 * W1-PRIV-01 COMPLETE — static SQL contract (tenant-isolation suite).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = '090_consent_lifecycle_append_only.sql';

function sqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(join(path, '052_parent_consent_version.sql'), 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/sql/');
}

describe('W1-PRIV-01 COMPLETE consent lifecycle SQL (089)', () => {
  it('ships 089 migration with parent + student append-only guards', () => {
    expect(existsSync(join(sqlDir(), MIGRATION))).toBe(true);
    const sql = readFileSync(join(sqlDir(), MIGRATION), 'utf8');
    expect(sql).toMatch(/parent_consents_body_immutable/);
    expect(sql).toMatch(/student_consents_body_immutable/);
    expect(sql).toMatch(/parent_consents_reject_delete/);
    expect(sql).toMatch(/student_consents_reject_delete/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS student_consents_tenant_id_student_id_kind_key/);
  });
});
