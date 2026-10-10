#!/usr/bin/env node
/**
 * PRC-H062 — rendered-manifest contract for deploy.yml's deploy-platform job.
 *
 * Renders the proctira-platform chart through tools/scripts/deploy-platform-helm.sh
 * (`template` mode = the exact value arguments the job's `upgrade` uses) and
 * asserts on the parsed manifests, not on workflow text:
 *   - only the etl-worker and exam-document-worker Deployments render; no other
 *     long-running workload kind, and Services / HPAs / PDBs target only them;
 *   - no Ingress (or other public entry point) and no LoadBalancer/NodePort;
 *   - every container image is the CI-built repository:tag
 *     (<registry>/<namespace>/proctira/<service>:<tag>) — no `proctira/` Docker
 *     Hub default and no registry-less reference.
 *
 * Usage (repo root):
 *   node tools/scripts/check-platform-deploy-render.mjs
 *       render staging + production with CI placeholder coordinates
 *   node tools/scripts/check-platform-deploy-render.mjs --rendered <file> \
 *       [--registry ghcr.io --namespace example-owner --tag sha-ci]
 *       check an existing `helm template` output (e.g. a pre-fix render)
 *
 * Env: HELM (default `helm`) is forwarded to deploy-platform-helm.sh.
 * Exits 1 on any violation.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAllDocuments } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Workloads this release may run (app.kubernetes.io/name). */
export const PLATFORM_WORKERS = ['etl-worker', 'exam-document-worker'];
/** Edge apps owned by the thin proctira-service releases. */
export const EDGE_APPS = [
  'api-gateway',
  'web',
  'registration-portal',
  'public-website',
  'admin-console',
  'developer-portal',
];
/** CronJob container name → CI-built service image it must run. */
export const DR_CONTAINERS = { 'pg-backup': 'dr-tools', 'phi-retention': 'dr-tools' };

/** CI placeholder coordinates (mixed-case namespace exercises lowercasing). */
export const CI_COORDS = Object.freeze({
  registry: 'ghcr.io',
  namespace: 'Example-Owner',
  tag: 'sha-ci',
  secret: 'ci-platform-secret',
});

const FORBIDDEN_KINDS = new Set([
  'Ingress',
  'IngressRoute',
  'HTTPRoute',
  'GRPCRoute',
  'TLSRoute',
  'Gateway',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Pod',
]);

/** Canonical CI repository, via the same script deploy.yml uses. */
export function ciRepository(registry, namespace, service) {
  return execFileSync(
    'bash',
    [join(ROOT, 'tools/scripts/image-repository.sh'), registry, namespace, service],
    { encoding: 'utf8' },
  ).trim();
}

/** `helm template` with exactly the deploy job's value arguments. */
export function renderPlatformDeploy({ environment, registry, namespace, tag, secret }) {
  return execFileSync('bash', [join(ROOT, 'tools/scripts/deploy-platform-helm.sh'), 'template'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ENVIRONMENT: environment,
      IMAGE_TAG: tag,
      PLATFORM_EXISTING_SECRET: secret,
      REGISTRY: registry,
      IMAGE_NAMESPACE: namespace,
    },
  });
}

export function parseManifests(text) {
  const docs = [];
  for (const doc of parseAllDocuments(text)) {
    if (doc.errors.length > 0) throw new Error(`invalid rendered YAML: ${doc.errors[0].message}`);
    const value = doc.toJS();
    if (value && typeof value === 'object') docs.push(value);
  }
  return docs;
}

const label = (d) =>
  d?.metadata?.labels?.['app.kubernetes.io/name'] ??
  d?.spec?.template?.metadata?.labels?.['app.kubernetes.io/name'];
const ref = (d) => `${d.kind}/${d?.metadata?.name ?? '<unnamed>'}`;

function podSpecOf(d) {
  if (d.kind === 'CronJob') return d?.spec?.jobTemplate?.spec?.template?.spec;
  if (d.kind === 'Pod') return d.spec;
  return d?.spec?.template?.spec;
}

function containersOf(spec) {
  return [
    ...(spec?.initContainers ?? []),
    ...(spec?.containers ?? []),
    ...(spec?.ephemeralContainers ?? []),
  ];
}

/** True when the first path segment is a registry host (has `.`/`:` or is localhost). */
export function hasRegistryHost(image) {
  const first = String(image).split('/')[0];
  return String(image).includes('/') && (/[.:]/.test(first) || first === 'localhost');
}

/**
 * @param {object[]} docs parsed manifests
 * @param {{ registry: string, namespace: string, tag: string }} coords
 * @returns {string[]} violations
 */
export function platformRenderViolations(docs, { registry, namespace, tag }) {
  const out = [];
  const expected = (service) => `${ciRepository(registry, namespace, service)}:${tag}`;
  const ciPrefix = `${ciRepository(registry, namespace, 'x').slice(0, -1)}`;
  const workers = new Set(PLATFORM_WORKERS);

  const deployments = docs.filter((d) => d.kind === 'Deployment');
  const deployed = new Set(deployments.map(label));
  for (const d of deployments) {
    if (!workers.has(label(d))) {
      out.push(`${ref(d)} (${label(d)}) must not render: only ${PLATFORM_WORKERS.join(', ')}`);
    }
  }
  for (const w of PLATFORM_WORKERS) {
    const n = deployments.filter((d) => label(d) === w).length;
    if (n !== 1) out.push(`expected exactly one ${w} Deployment, got ${n}`);
  }
  const workerDeploymentNames = new Set(
    deployments.filter((d) => workers.has(label(d))).map((d) => d.metadata.name),
  );

  for (const d of docs) {
    if (FORBIDDEN_KINDS.has(d.kind)) out.push(`${ref(d)}: kind ${d.kind} must not render`);
    if (d.kind === 'Service') {
      const type = d?.spec?.type ?? 'ClusterIP';
      if (type !== 'ClusterIP') out.push(`${ref(d)}: Service type ${type} exposes the release`);
      const sel = d?.spec?.selector?.['app.kubernetes.io/name'];
      if (!workers.has(sel)) out.push(`${ref(d)}: selects ${sel ?? '<none>'}, not a worker`);
    }
    if (d.kind === 'HorizontalPodAutoscaler') {
      const target = d?.spec?.scaleTargetRef?.name;
      if (!workerDeploymentNames.has(target)) {
        out.push(`${ref(d)}: scales ${target ?? '<none>'}, not a worker Deployment`);
      }
    }
    if (d.kind === 'PodDisruptionBudget') {
      const sel = d?.spec?.selector?.matchLabels?.['app.kubernetes.io/name'];
      if (!workers.has(sel)) out.push(`${ref(d)}: protects ${sel ?? '<none>'}, not a worker`);
    }
    if (EDGE_APPS.includes(label(d))) out.push(`${ref(d)}: edge app ${label(d)} resource rendered`);

    const spec = podSpecOf(d);
    if (!spec || !['Deployment', 'CronJob', 'Job', 'Pod'].includes(d.kind)) continue;
    for (const c of containersOf(spec)) {
      const image = String(c.image ?? '');
      const where = `${ref(d)} container ${c.name}`;
      if (image.startsWith('proctira/') || image.startsWith('docker.io/proctira/')) {
        out.push(`${where}: Docker Hub default image ${image}`);
      }
      if (!hasRegistryHost(image))
        out.push(`${where}: image ${image || '<empty>'} has no registry`);
      if (!image.startsWith(ciPrefix) || !image.endsWith(`:${tag}`)) {
        out.push(`${where}: image ${image} is not a CI-built ${ciPrefix}<service>:${tag}`);
      }
      const service =
        d.kind === 'Deployment' && workers.has(label(d)) ? label(d) : DR_CONTAINERS[c.name];
      if (service && image !== expected(service)) {
        out.push(`${where}: image ${image} must be ${expected(service)}`);
      }
    }
  }
  if (deployed.size === 0) out.push('no Deployments rendered');
  return out;
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const coords = {
    registry: argValue(argv, 'registry') ?? CI_COORDS.registry,
    namespace: argValue(argv, 'namespace') ?? CI_COORDS.namespace,
    tag: argValue(argv, 'tag') ?? CI_COORDS.tag,
    secret: CI_COORDS.secret,
  };
  const renderedFile = argValue(argv, 'rendered');
  const targets = renderedFile
    ? [{ name: renderedFile, text: readFileSync(renderedFile, 'utf8') }]
    : ['staging', 'production'].map((environment) => ({
        name: environment,
        text: renderPlatformDeploy({ environment, ...coords }),
      }));
  let failed = false;
  for (const { name, text } of targets) {
    const violations = platformRenderViolations(parseManifests(text), coords);
    if (violations.length > 0) {
      failed = true;
      for (const v of violations) console.error(`check-platform-deploy-render [${name}]: ${v}`);
    } else {
      console.log(`OK platform deploy render [${name}]: workers + DR only, CI-built images`);
    }
  }
  process.exit(failed ? 1 : 0);
}
