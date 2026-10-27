#!/usr/bin/env node
/**
 * Local compose contract (docker-compose.yml).
 *
 *   PRC-L335: every service with a `build:` (first-party app image) declares a
 *             compose-level `healthcheck`, so dependents can use
 *             `condition: service_healthy` and `docker compose ps` shows health.
 *   PRC-L460: the postgres container superuser (POSTGRES_USER) does not default
 *             to the migrator/runtime role, MIGRATOR_PASSWORD/APP_ROLE_PASSWORD
 *             are required from .env, and db/docker-init/* hard-codes no
 *             `PASSWORD '<literal>'`.
 *
 * Usage: node tools/scripts/check-compose-contract.mjs [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const RESERVED_ROLES = new Set(['proctira', 'proctira_app']);

/** Resolves the default of a compose value such as `${VAR:-default}` or a literal. */
export function composeDefault(value) {
  const s = String(value ?? '');
  const m = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::?-([^}]*))?\}$/.exec(s);
  if (m) return m[1] ?? '';
  return s;
}

/**
 * PRC-L460: the postgres container superuser must not default to the migrator
 * or runtime role, and the role passwords must come from .env.
 */
export function checkPostgresBootstrap(compose) {
  const errors = [];
  const env = compose?.services?.postgres?.environment ?? {};
  const user = composeDefault(env.POSTGRES_USER);
  if (!user || RESERVED_ROLES.has(user)) {
    errors.push(
      `docker-compose.yml postgres POSTGRES_USER defaults to '${user}'; it must be a separate bootstrap superuser, not the migrator/runtime role (PRC-L460)`,
    );
  }
  for (const key of ['MIGRATOR_PASSWORD', 'APP_ROLE_PASSWORD']) {
    if (!/^\$\{[A-Z_]+:\?/.test(String(env[key] ?? ''))) {
      errors.push(
        `docker-compose.yml postgres ${key} must be required from .env (\${${key}:?...}) (PRC-L460)`,
      );
    }
  }
  return errors;
}

/** PRC-L460: no hard-coded role passwords in db/docker-init. `files` maps name -> text. */
export function checkDockerInitPasswords(files) {
  const errors = [];
  for (const [name, text] of Object.entries(files)) {
    String(text)
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/PASSWORD\s+'[^']*'/i.test(line)) {
          errors.push(`db/docker-init/${name}:${i + 1} hard-codes a role password (PRC-L460)`);
        }
      });
  }
  return errors;
}

/** Runs every contract over the parsed files. */
export function checkComposeContract({ compose, dockerInit = {} }) {
  return [
    ...checkBuiltServiceHealthchecks(compose),
    ...checkPostgresBootstrap(compose),
    ...checkDockerInitPasswords(dockerInit),
  ];
}

function readDockerInit(root) {
  const dir = join(root, 'db/docker-init');
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  );
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;
  const compose = parse(readFileSync(join(root, 'docker-compose.yml'), 'utf8'));
  const errors = checkComposeContract({ compose, dockerInit: readDockerInit(root) });
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
