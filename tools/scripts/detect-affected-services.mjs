#!/usr/bin/env node
/**
 * PRC-M259: shared affected-service detection + Dockerfile mapping for
 * deploy.yml and release.yml, driven by tools/scripts/services.json.
 *
 *   node tools/scripts/detect-affected-services.mjs affected \
 *     --workflow deploy|release --head <sha> [--base <sha>]
 *     → prints the comma-separated service list.
 *     The diff covers base..head (every commit since the last successful
 *     run), not just HEAD~1. A missing/unknown/non-ancestor base fails safe
 *     to every service in the workflow scope.
 *
 *   node tools/scripts/detect-affected-services.mjs docker-config --service <name>
 *     → prints GITHUB_OUTPUT lines: dockerfile=…, build-args<<EOF … EOF.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadManifest(path = join(here, 'services.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Services the workflow may build/deploy (lab images only in release). */
export function servicesInScope(manifest, workflow) {
  const canonical = Object.entries(manifest.services)
    .filter(([, s]) => s.workflows.includes(workflow))
    .map(([name]) => name);
  const lab = workflow === 'release' ? Object.keys(manifest.labServices.ports) : [];
  return [...canonical, ...lab];
}

/** Pure mapping from changed files to affected services. */
export function affectedFromFiles(manifest, workflow, files) {
  const scope = servicesInScope(manifest, workflow);
  if (files.some((f) => manifest.fanoutPaths.some((p) => f === p || f.startsWith(p)))) {
    return scope;
  }
  const hit = new Set();
  for (const [name, svc] of Object.entries(manifest.services)) {
    if (!svc.workflows.includes(workflow)) continue;
    if (files.some((f) => svc.paths.some((p) => f === p || f.startsWith(p)))) hit.add(name);
  }
  if (workflow === 'release') {
    for (const lab of Object.keys(manifest.labServices.ports)) {
      if (files.some((f) => f.startsWith(`packages/backend/${lab}/`))) hit.add(lab);
    }
  }
  return scope.filter((s) => hit.has(s));
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Changed files in base..head, or null when the base cannot be trusted. */
export function changedFiles({ base, head, cwd = process.cwd() }) {
  if (!base || !/^[0-9a-f]{7,40}$/i.test(base)) return null;
  try {
    git(['cat-file', '-e', `${base}^{commit}`], cwd);
    git(['merge-base', '--is-ancestor', base, head], cwd);
  } catch {
    return null;
  }
  return git(['diff', '--name-only', base, head], cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function detectAffected({ manifest = loadManifest(), workflow, base, head, cwd }) {
  const files = changedFiles({ base, head, cwd });
  if (files === null) return servicesInScope(manifest, workflow);
  return affectedFromFiles(manifest, workflow, files);
}

export function dockerConfig(manifest, service) {
  const svc = manifest.services[service];
  if (svc) {
    const args = Object.entries(svc.buildArgs).map(([k, v]) => `${k}=${v}`);
    return { dockerfile: svc.dockerfile, buildArgs: args };
  }
  const port = manifest.labServices.ports[service];
  if (!port) throw new Error(`Unknown service "${service}" (not in tools/scripts/services.json)`);
  return {
    dockerfile: manifest.labServices.dockerfile,
    buildArgs: [`SERVICE_NAME=${service}`, `SERVICE_PORT=${port}`],
  };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const manifest = loadManifest();
  if (cmd === 'affected') {
    const workflow = argValue(rest, 'workflow');
    if (workflow !== 'deploy' && workflow !== 'release') {
      console.error('--workflow must be deploy or release');
      process.exit(2);
    }
    const head = argValue(rest, 'head') ?? 'HEAD';
    const base = argValue(rest, 'base');
    process.stdout.write(`${detectAffected({ manifest, workflow, base, head }).join(',')}\n`);
  } else if (cmd === 'docker-config') {
    const { dockerfile, buildArgs } = dockerConfig(manifest, argValue(rest, 'service') ?? '');
    process.stdout.write(`dockerfile=${dockerfile}\nbuild-args<<EOF\n${buildArgs.join('\n')}\nEOF\n`);
  } else {
    console.error('usage: detect-affected-services.mjs affected|docker-config …');
    process.exit(2);
  }
}
