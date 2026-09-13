/**
 * W1-PRIV-01 (C2) — static contract for parent consent versioning migration.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlPath = join(root, 'db/sql/052_parent_consent_version.sql');

describe('W1-PRIV-01 parent consent version (static)', () => {
  it('ships additive migration requiring consent_version on parent_consents', () => {
    expect(existsSync(sqlPath), 'missing db/sql/052_parent_consent_version.sql').toBe(true);
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/parent_consents/);
    expect(sql).toMatch(/consent_version/);
    expect(sql).toMatch(/SET NOT NULL/);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});
