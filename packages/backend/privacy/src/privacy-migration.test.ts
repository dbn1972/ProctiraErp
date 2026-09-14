import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sql067 = join(root, 'db/sql/067_privacy_legal_hold_erasure.sql');
const sql076 = join(root, 'db/sql/076_privacy_lifecycle_complete.sql');

describe('W1-SEC-06 privacy SQL (static)', () => {
  it('ships additive migration for legal hold + erasure requests', () => {
    expect(existsSync(sql067)).toBe(true);
    const sql = readFileSync(sql067, 'utf8');
    expect(sql).toMatch(/privacy_legal_holds/);
    expect(sql).toMatch(/privacy_erasure_requests/);
    expect(sql).toMatch(/blocked_legal_hold/);
    expect(sql).toMatch(/privacy_block_student_delete_on_legal_hold/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it('ships additive migration for correction + anonymization jobs + offboard', () => {
    expect(existsSync(sql076)).toBe(true);
    const sql = readFileSync(sql076, 'utf8');
    expect(sql).toMatch(/privacy_correction_requests/);
    expect(sql).toMatch(/privacy_anonymization_jobs/);
    expect(sql).toMatch(/privacy_tenant_offboard_jobs/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
