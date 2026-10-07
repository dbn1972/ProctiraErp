#!/usr/bin/env node
/**
 * #555 review #3 (PRC-M279): the api-gateway's per-workload ExternalSecret
 * allowlist (`externalSecret.serviceKeys.api-gateway` in
 * infrastructure/helm/proctira-service/values.yaml) must cover every
 * secret-bearing env var that code mounted in the gateway process reads.
 * Otherwise enabling ESO strips a key from the pod, and the feature fails at
 * request time (not at boot, so `helm --atomic --wait` cannot roll it back).
 *
 * The gateway runs every domain package in-process, so the scan covers
 * apps/api-gateway/src, packages/backend/<pkg>/src and packages/shared/<pkg>/src
 * (non-test sources). A name is "secret-bearing" when it matches SECRET_NAME.
 * Each one must be in serviceKeys (rendered), optionalServiceKeys (documented,
 * mode-dependent) or NOT_FROM_SHARED_BUNDLE below, which records where it
 * comes from instead.
 *
 *   node tools/scripts/check-gateway-secret-allowlist.mjs [--root <repo>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Env names that carry credentials/keys or credential-bearing URLs. */
export const SECRET_NAME =
  /(SECRET|PASSWORD|PRIVATE_KEY|ENCRYPTION_KEY|SIGNING|_KMS_|SASL_USERNAME|ACCESS_KEY|INSTALL_TOKEN|^DATABASE_URL$|^REDIS_URL$|^RABBITMQ_URL$|REPLICA_URL$)/;

/**
 * Secret-looking names that intentionally do NOT come from the shared bundle.
 * Every entry needs a reason; reviewers own this list.
 */
export const NOT_FROM_SHARED_BUNDLE = Object.freeze({
  SQS_ACCESS_KEY_ID:
    'SQS is not a production queue backend (allowlist carries Kafka/RabbitMQ); on AWS it uses the pod IAM role, static keys are lab-only',
  SQS_SECRET_ACCESS_KEY:
    'SQS is not a production queue backend (allowlist carries Kafka/RabbitMQ); on AWS it uses the pod IAM role, static keys are lab-only',
  INSTALL_TOKEN:
    'first-run installer token; injected by the operator for the one-off install, never part of the steady-state bundle',
  TEST_DATABASE_URL: 'test-only connection string (never set in a deployed pod)',
  PHI_KMS_STUB_SECRET: 'dev/test KMS stub; production refuses the stub',
  WEBHOOK_SIGNING_KMS_STUB_SECRET: 'dev/test KMS stub; production refuses the stub',
  ALLOW_WEBHOOK_KMS_STUB: 'boolean flag (not a secret); plain env/config',
  PHI_KMS_CLIENT: 'KMS client selector (not a secret); plain env/config',
  PHI_KMS_REGION: 'AWS region (not a secret); plain env/config',
  PHI_KMS_KEY_VERSION: 'key version selector (not a secret); plain env/config',
  WEBHOOK_SIGNING_KMS_CLIENT: 'KMS client selector (not a secret); plain env/config',
  WEBHOOK_SIGNING_KMS_REGION: 'AWS region (not a secret); plain env/config',
});

const ENV_READ = /\b(?:process\.env|env)(?:\??\.|\??\.?\[\s*['"`])([A-Z][A-Z0-9_]{2,})/g;
const TEST_FILE = /\.(test|spec)\.tsx?$|\.d\.ts$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '__tests__', 'test', 'tests', 'fixtures']);

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.tsx?$/.test(name) && !TEST_FILE.test(name)) yield full;
  }
}

/** Secret-bearing env names read by gateway-process code → first reader. */
export function secretEnvReads(root) {
  const roots = [join(root, 'apps/api-gateway/src')];
  for (const group of ['packages/backend', 'packages/shared']) {
    let pkgs = [];
    try {
      pkgs = readdirSync(join(root, group));
    } catch {
      /* absent */
    }
    for (const pkg of pkgs) roots.push(join(root, group, pkg, 'src'));
  }
  const found = new Map();
  for (const dir of roots) {
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(ENV_READ)) {
        const name = m[1];
        if (SECRET_NAME.test(name) && !found.has(name)) {
          found.set(name, file.slice(root.length + 1));
        }
      }
    }
  }
  return found;
}

/** Pure comparison used by the CLI and tests. */
export function compare(reads, allowlist, exceptions = NOT_FROM_SHARED_BUNDLE) {
  const allowed = new Set(allowlist);
  const missing = [...reads.keys()]
    .filter((name) => !allowed.has(name) && !(name in exceptions))
    .sort();
  const unused = [...allowed].filter((name) => !reads.has(name)).sort();
  return { missing, unused };
}

async function loadYaml(root) {
  const store = join(root, 'node_modules/.pnpm');
  let entries = [];
  try {
    entries = readdirSync(store)
      .filter((d) => /^js-yaml@4\.\d+\.\d+$/.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    /* no pnpm store */
  }
  const candidates = [
    ...entries.map((d) => join(store, d, 'node_modules/js-yaml/dist/js-yaml.mjs')),
    join(root, 'node_modules/js-yaml/dist/js-yaml.mjs'),
  ];
  for (const c of candidates) {
    try {
      return await import(pathToFileURL(c).href);
    } catch {
      /* try next */
    }
  }
  throw new Error('Unable to locate js-yaml. Run `pnpm install` first.');
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const i = process.argv.indexOf('--root');
  const root = resolve(i === -1 ? process.cwd() : process.argv[i + 1]);
  const yaml = await loadYaml(root);
  const values = yaml.load(
    readFileSync(join(root, 'infrastructure/helm/proctira-service/values.yaml'), 'utf8'),
  );
  const allowlist = values?.externalSecret?.serviceKeys?.['api-gateway'];
  const optional = values?.externalSecret?.optionalServiceKeys?.['api-gateway'] ?? [];
  if (!Array.isArray(allowlist) || !Array.isArray(optional)) {
    console.error('::error::externalSecret.serviceKeys.api-gateway is missing from values.yaml');
    process.exit(1);
  }
  const reads = secretEnvReads(root);
  const { missing, unused } = compare(reads, [...allowlist, ...optional]);
  for (const name of unused) {
    console.log(`::notice::allowlisted ${name} is not read via process.env in gateway code`);
  }
  if (missing.length > 0) {
    for (const name of missing) {
      console.error(
        `::error::${name} (read in ${reads.get(name)}) is not in externalSecret.serviceKeys.api-gateway; add it or document its source in NOT_FROM_SHARED_BUNDLE`,
      );
    }
    process.exit(1);
  }
  console.log(
    `PRC-M279: ${reads.size} secret-bearing env reads covered by the api-gateway allowlist (${allowlist.length} keys).`,
  );
}
