/**
 * PRC-L387 — check-icon-only-button.mjs must exit 1 for an unlabeled
 * icon-only <Button> and 0 when the button has an accessible name. Fixture
 * files are passed as positional targets; the default app globs are not used.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'check-icon-only-button.mjs');

const HEADER = `import { TrashIcon } from 'lucide-react';
import { Button } from '@proctira/ui';
`;

function scan(body) {
  const dir = mkdtempSync(join(tmpdir(), 'l387-icon-'));
  try {
    const file = join(dir, 'Fixture.tsx');
    writeFileSync(file, HEADER + body);
    return spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('unlabeled icon-only button fails the gate', () => {
  const r = scan('export const A = () => <Button><TrashIcon /></Button>;\n');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /icon-only-button-requires-aria-label/);
  assert.match(r.stderr, /1 violation/);
});

test('labeled icon-only buttons pass', () => {
  const r = scan(`export const A = () => <Button aria-label="Delete"><TrashIcon /></Button>;
export const B = () => (
  <Button>
    <TrashIcon />
    <span className="sr-only">Delete</span>
  </Button>
);
`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 violations across 1 file/);
});
