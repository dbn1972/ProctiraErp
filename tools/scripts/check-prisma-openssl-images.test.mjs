/**
 * UATENV-D01: Release backend images must carry Prisma's OpenSSL 3 engine.
 *
 * `pnpm install` runs `prisma generate` (packages/shared/database postinstall).
 * Prisma picks the musl engine by probing OpenSSL; without the `openssl` package
 * in that stage it falls back to the OpenSSL 1.1 engine
 * (libquery_engine-linux-musl.so.node). The node:20-alpine runner ships only
 * libssl.so.3, so api-gateway, etl-worker and exam-document-worker crashed at
 * boot with "Error loading shared library libssl.so.1.1".
 *
 * Pins: the stage that runs `pnpm install` (through its FROM chain) and the
 * runner stage both `apk add` openssl.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PRISMA_RELEASE_DOCKERFILES = [
  'infrastructure/docker/Dockerfile.api-gateway',
  'infrastructure/docker/Dockerfile.etl-worker',
  'workers/exam-document/Dockerfile',
];

/** Splits a Dockerfile into stages: { name, from, lines }. */
function stages(text) {
  const result = [];
  let current;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      current = { from: from[1], name: from[2] ?? `stage${result.length}`, lines: [] };
      result.push(current);
      continue;
    }
    if (current && line && !line.startsWith('#')) current.lines.push(line);
  }
  return result;
}

/** The stage and every stage it is built FROM. */
function chain(all, stage) {
  const out = [];
  for (let s = stage; s; s = all.find((candidate) => candidate.name === s.from)) out.push(s);
  return out;
}

function installsOpenssl(stageList) {
  return stageList.some((stage) => stage.lines.some((line) => /apk add\b.*\bopenssl\b/.test(line)));
}

describe('Release backend images carry the Prisma OpenSSL 3 engine (UATENV-D01)', () => {
  for (const file of PRISMA_RELEASE_DOCKERFILES) {
    const all = stages(readFileSync(join(ROOT, file), 'utf8'));

    it(`${file}: the stage running pnpm install has openssl`, () => {
      const install = all.find((stage) => stage.lines.some((l) => /pnpm install\b/.test(l)));
      assert.ok(install, 'no stage runs pnpm install');
      assert.ok(
        installsOpenssl(chain(all, install)),
        `${install.name} (or its base) must apk add openssl before prisma generate`,
      );
    });

    it(`${file}: the runner stage has openssl`, () => {
      const runner = all.at(-1);
      assert.equal(runner?.name, 'runner');
      assert.ok(installsOpenssl(chain(all, runner)), 'runner must apk add openssl');
    });
  }
});
