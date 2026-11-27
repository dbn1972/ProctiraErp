import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRootFromHere } from '../repo.js';

import { validateSuiteSpec, type Cadence, type SuiteSpec } from './spec.js';

/** Suite files: src/foundation/suite.json and src/tracks/<unit>/suite.json. */
export function suiteFiles(repoRoot = repoRootFromHere()): string[] {
  const base = join(repoRoot, 'tools/aitest/src');
  const files = [join(base, 'foundation', 'suite.json')];
  const tracks = join(base, 'tracks');
  if (existsSync(tracks)) {
    for (const d of readdirSync(tracks).sort()) {
      const f = join(tracks, d, 'suite.json');
      if (existsSync(f)) files.push(f);
    }
  }
  return files.filter((f) => existsSync(f));
}

export function discoverSuites(repoRoot = repoRootFromHere()): SuiteSpec[] {
  const out: SuiteSpec[] = [];
  const seen = new Set<string>();
  for (const file of suiteFiles(repoRoot)) {
    const where = relative(repoRoot, file);
    const doc = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    for (const raw of Array.isArray(doc) ? doc : [doc]) {
      const spec = { ...validateSuiteSpec(raw, where), file: where };
      if (seen.has(spec.id)) throw new Error(`${where}: duplicate suite id ${spec.id}`);
      seen.add(spec.id);
      out.push(spec);
    }
  }
  return out;
}

export function suitesForCadence(suites: SuiteSpec[], cadence: Cadence): SuiteSpec[] {
  return suites.filter((s) => s.cadence !== 'script' && s.cadence.includes(cadence));
}
