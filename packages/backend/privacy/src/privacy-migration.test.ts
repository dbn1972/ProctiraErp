import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlPath = join(root, 'db/sql/067_privacy_legal_hold_erasure.sql');

describe('W1-SEC-06 privacy legal hold SQL (static)', () => {
  it('ships additive migration for legal hold + erasure requests', () => {
    expect(existsSync(sqlPath)).toBe(true);
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/privacy_legal_holds/);
    expect(sql).toMatch(/privacy_erasure_requests/);
    expect(sql).toMatch(/blocked_legal_hold/);
    expect(sql).toMatch(/privacy_block_student_delete_on_legal_hold/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});
