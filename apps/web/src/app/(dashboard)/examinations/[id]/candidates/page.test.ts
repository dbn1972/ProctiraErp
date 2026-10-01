/**
 * PRC-L036 — the candidates table must not present a UUID fragment as an
 * issued registration number (the backend does not issue one yet).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

describe('examination candidates column (PRC-L036)', () => {
  it('labels the id column as a reference, not a registration number', () => {
    expect(src).not.toContain('Registration #');
    expect(src).not.toContain("resolveEntityLabel(candidate.id, {}, 'Reg')");
    expect(src).toContain('Candidate ref');
  });
});
