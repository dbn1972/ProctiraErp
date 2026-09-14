/**
 * W1-PRIV-01 COMPLETE — static SQL contract for append-only consent lifecycle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sql052 = join(root, 'db/sql/052_parent_consent_version.sql');
const sql089 = join(root, 'db/sql/089_consent_lifecycle_append_only.sql');

describe('W1-PRIV-01 parent consent version (static PARTIAL foundation)', () => {
  it('ships additive migration requiring consent_version on parent_consents', () => {
    expect(existsSync(sql052), 'missing db/sql/052_parent_consent_version.sql').toBe(true);
    const sql = readFileSync(sql052, 'utf8');
    expect(sql).toMatch(/parent_consents/);
    expect(sql).toMatch(/consent_version/);
    expect(sql).toMatch(/SET NOT NULL/);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});

describe('W1-PRIV-01 COMPLETE consent lifecycle SQL (089)', () => {
  it('ships 089 migration', () => {
    expect(existsSync(sql089)).toBe(true);
  });

  it('versions parent_consents with immutable body + close-only valid_to + delete reject', () => {
    const sql = readFileSync(sql089, 'utf8');
    expect(sql).toMatch(/consent_chain_id/);
    expect(sql).toMatch(/parent_consents_body_immutable/);
    expect(sql).toMatch(/parent_consents_reject_delete/);
    expect(sql).toMatch(/parent_consents_chain_version_uidx/);
    expect(sql).toMatch(/parent_consents_chain_open_uidx/);
    expect(sql).toMatch(/valid_to can only narrow/);
  });

  it('versions student_consents and drops silent UPSERT uniqueness', () => {
    const sql = readFileSync(sql089, 'utf8');
    expect(sql).toMatch(/student_consents_body_immutable/);
    expect(sql).toMatch(/student_consents_reject_delete/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS student_consents_tenant_id_student_id_kind_key/);
    expect(sql).toMatch(/student_consents_kind_version_uidx/);
    expect(sql).toMatch(/student_consents_kind_open_uidx/);
  });
});
