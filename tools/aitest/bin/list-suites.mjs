#!/usr/bin/env node
/**
 * Prints the JSON array of aitest suite ids for one cadence, for the
 * aitest-scheduled.yml matrix. Dependency-free (runs before pnpm install).
 *
 *   node tools/aitest/bin/list-suites.mjs --cadence nightly|weekly
 *
 * Reads src/foundation/suite.json and src/tracks/<unit>/suite.json (object or
 * array). Suites with cadence 'script' are never scheduled.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function suiteFiles(aitestDir) {
  const files = [join(aitestDir, 'src', 'foundation', 'suite.json')];
  const tracks = join(aitestDir, 'src', 'tracks');
  if (existsSync(tracks)) {
    for (const d of readdirSync(tracks).sort()) files.push(join(tracks, d, 'suite.json'));
  }
  return files.filter((f) => existsSync(f));
}

export function listSuites(aitestDir, cadence) {
  if (cadence !== 'nightly' && cadence !== 'weekly') {
    throw new Error(`--cadence must be nightly or weekly, got ${String(cadence)}`);
  }
  const ids = [];
  for (const file of suiteFiles(aitestDir)) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    for (const s of Array.isArray(doc) ? doc : [doc]) {
      if (typeof s.id !== 'string' || !ID_RE.test(s.id))
        throw new Error(`${file}: bad suite id ${String(s.id)}`);
      if (Array.isArray(s.cadence) && s.cadence.includes(cadence)) ids.push(s.id);
    }
  }
  return ids;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const i = process.argv.indexOf('--cadence');
  const cadence = i >= 0 ? process.argv[i + 1] : undefined;
  try {
    process.stdout.write(
      `${JSON.stringify(listSuites(join(dirname(fileURLToPath(import.meta.url)), '..'), cadence))}\n`,
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}
