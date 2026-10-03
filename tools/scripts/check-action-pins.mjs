#!/usr/bin/env node
/**
 * PRC-M257: fail when a workflow or composite action references a third-party
 * action by a mutable ref (tag/branch) instead of a full 40-hex commit SHA.
 * Local `./` actions and `docker://` images pinned by digest are allowed.
 *
 * Usage: node tools/scripts/check-action-pins.mjs [repoRoot]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*-?\s*uses:\s*['"]?([^\s'"#]+)/;

function walk(dir) {
  let out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out = out.concat(walk(abs));
    else if (/\.ya?ml$/.test(name)) out.push(abs);
  }
  return out;
}

/** Returns `{ file, line, ref }` for every non-SHA third-party `uses:` reference. */
export function findUnpinnedActions(root) {
  const violations = [];
  for (const file of walk(join(root, '.github'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      const m = USES_RE.exec(text);
      if (!m) return;
      const ref = m[1];
      if (ref.startsWith('./')) return;
      if (ref.startsWith('docker://')) {
        if (!/@sha256:[0-9a-f]{64}$/.test(ref)) {
          violations.push({ file: relative(root, file), line: i + 1, ref });
        }
        return;
      }
      const at = ref.lastIndexOf('@');
      if (at === -1 || !SHA_RE.test(ref.slice(at + 1))) {
        violations.push({ file: relative(root, file), line: i + 1, ref });
      }
    });
  }
  return violations;
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const root = resolve(process.argv[2] ?? process.cwd());
  const violations = findUnpinnedActions(root);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.file}:${v.line} ${v.ref} is not pinned to a full commit SHA`);
    }
    console.error(
      `\n${violations.length} unpinned action reference(s). Pin to <owner>/<repo>@<40-hex sha> # vX.Y.Z.`,
    );
    process.exit(1);
  }
  console.log('All third-party GitHub Actions are pinned to commit SHAs.');
}
