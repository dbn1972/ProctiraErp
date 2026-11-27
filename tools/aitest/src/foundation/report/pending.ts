/**
 * Per-track pending-fixes list (program plan D9). A generated case whose
 * correct-behaviour assertion currently fails is listed here with its finding
 * id; it still runs and is reported `pending-fix` instead of failing the
 * suite. This is not the CI skip allowlist.
 *
 * File: src/tracks/<unit>/pending-fixes.json
 *   { "$comment": "...", "cases": { "<case id>": "AIT-T01-001" } }
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadPendingFixes(trackDir: string): ReadonlyMap<string, string> {
  const file = join(trackDir, 'pending-fixes.json');
  if (!existsSync(file)) return new Map();
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { cases?: Record<string, unknown> };
  const out = new Map<string, string>();
  for (const [caseId, findingId] of Object.entries(doc.cases ?? {})) {
    if (typeof findingId !== 'string' || !/^AIT-T\d{2}-\d{3}$/.test(findingId)) {
      throw new Error(`${file}: case ${caseId} must map to a finding id like AIT-T01-001`);
    }
    out.set(caseId, findingId);
  }
  return out;
}
