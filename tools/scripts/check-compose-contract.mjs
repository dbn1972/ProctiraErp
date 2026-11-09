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
 *   UAT-ENV-008 (PRC-M311 step): the MinIO image is pinned by `@sha256:` digest
 *             and not taken from a repository that cannot be pulled anonymously.
 *   UAT-ENV-009: every published port binds to a loopback host IP
 *             (`${BIND_ADDRESS:-127.0.0.1}:...` or `host_ip:`), never all interfaces.
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

/**
 * Splits a short-syntax port spec on `:` outside `${...}` and `[...]`, so
 * `${BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-3001}:3001` gives three parts.
 */
export function splitPortSpec(spec) {
  const parts = [];
  let current = '';
  let depth = 0;
  for (const ch of String(spec)) {
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (ch === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}
/** True when a host IP (literal or `${VAR:-default}`) resolves to a loopback address. */
export function isLoopbackHostIp(value) {
  const ip = composeDefault(value).replace(/^\[(.*)\]$/, '$1');
  return /^127(\.\d{1,3}){3}$/.test(ip) || ip === '::1';
}
/**
 * UAT-ENV-009: every published port names a loopback host IP, normally
 * `${BIND_ADDRESS:-127.0.0.1}`. A port without one listens on every interface.
 * Handles the short syntax (`'ip:host:container'`) and the long syntax (`host_ip:`).
 */
export function checkPublishedPortBindAddress(compose) {
  const errors = [];
  for (const [name, svc] of Object.entries(compose?.services ?? {})) {
    for (const port of svc?.ports ?? []) {
      let hostIp;
      if (port !== null && typeof port === 'object') {
        hostIp = port.host_ip;
      } else {
        const parts = splitPortSpec(port);
        hostIp = parts.length === 3 ? parts[0] : undefined;
      }
      if (hostIp === undefined || !isLoopbackHostIp(hostIp)) {
        const shown = typeof port === 'object' ? JSON.stringify(port) : String(port);
        errors.push(
          `docker-compose.yml service ${name} publishes port ${shown} without a loopback bind address; use '\${BIND_ADDRESS:-127.0.0.1}:<host>:<container>' (UAT-ENV-009)`,
        );
      }
    }
  }
  return errors;
}

/**
 * MinIO repositories that cannot be pulled anonymously (UAT-ENV-008): Docker Hub
 * `minio/minio` was withdrawn and `quay.io/minio/minio` requires authentication.
 */
const UNPULLABLE_MINIO_REPOS = new Set([
  'minio/minio',
  'docker.io/minio/minio',
  'index.docker.io/minio/minio',
  'quay.io/minio/minio',
]);

/** Splits an image reference into its repository (no tag, no digest) and digest. */
export function parseImageRef(image) {
  const s = String(image ?? '').trim();
  const at = s.indexOf('@');
  const name = at >= 0 ? s.slice(0, at) : s;
  const digest = at >= 0 ? s.slice(at + 1) : '';
  const lastSlash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  const repository = colon > lastSlash ? name.slice(0, colon) : name;
  return { repository, digest };
}

/**
 * UAT-ENV-008 / PRC-M311: every MinIO service image (service `minio` or an image
 * whose repository ends in `/minio`) is pinned by `@sha256:` digest and does not
 * come from a repository that cannot be pulled anonymously.
 */
export function checkMinioImagePin(compose) {
  const errors = [];
  for (const [name, svc] of Object.entries(compose?.services ?? {})) {
    const image = svc?.image;
    if (image === undefined) continue;
    const { repository, digest } = parseImageRef(image);
    if (name !== 'minio' && !/(^|\/)minio$/.test(repository)) continue;
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      errors.push(
        `docker-compose.yml service ${name} image '${image}' is not pinned by @sha256: digest (UAT-ENV-008, PRC-M311)`,
      );
    }
    if (UNPULLABLE_MINIO_REPOS.has(repository)) {
      errors.push(
        `docker-compose.yml service ${name} image '${image}' uses ${repository}, which cannot be pulled anonymously (UAT-ENV-008, PRC-M311)`,
      );
    }
  }
  return errors;
}

/** Runs every contract over the parsed files. */
export function checkComposeContract({ compose, dockerInit = {} }) {
  return [
    ...checkBuiltServiceHealthchecks(compose),
    ...checkPublishedPortBindAddress(compose),
    ...checkPostgresBootstrap(compose),
    ...checkDockerInitPasswords(dockerInit),
    ...checkMinioImagePin(compose),
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
