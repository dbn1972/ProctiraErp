#!/usr/bin/env node
/**
 * Local compose contract (docker-compose.yml).
 *
 *   PRC-L335: every service with a `build:` (first-party app image) declares a
 *             compose-level `healthcheck`, so dependents can use
 *             `condition: service_healthy` and `docker compose ps` shows health.
 *
 * Usage: node tools/scripts/check-compose-contract.mjs [--root <dir>]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** PRC-L335: built services without a healthcheck. Returns error strings. */
export function checkBuiltServiceHealthchecks(compose) {
  const errors = [];
  for (const [name, svc] of Object.entries(compose?.services ?? {})) {
    if (svc && svc.build !== undefined) {
      const hc = svc.healthcheck;
      if (!hc || hc.disable === true || !hc.test) {
        errors.push(`docker-compose.yml service ${name} has build: but no healthcheck (PRC-L335)`);
      }
    }
  }
  return errors;
}

/** Runs every contract over the parsed files. */
export function checkComposeContract({ compose }) {
  return [...checkBuiltServiceHealthchecks(compose)];
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;
  const compose = parse(readFileSync(join(root, 'docker-compose.yml'), 'utf8'));
  const errors = checkComposeContract({ compose, root });
  if (errors.length > 0) {
    console.error('check-compose-contract: FAIL');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log('check-compose-contract: PASS');
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  process.exit(main(process.argv.slice(2)));
}
