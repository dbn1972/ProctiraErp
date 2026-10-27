#!/usr/bin/env node
/**
 * PRC-L111 — Dependabot must cover every Dockerfile and compose directory.
 *
 * Fails when a git-tracked `Dockerfile*` directory is not matched by a
 * `docker` entry, or a git-tracked `docker-compose*.yml` directory is not
 * matched by a `docker-compose` entry, in .github/dependabot.yml.
 * `directory:` and `directories:` (inline or block list) are both read; `*`
 * matches one path segment and `**` any number of segments.
 *
 * Dependency-free line parser for this fixed-shape file (node: built-ins only)
 * because it runs in the workflow-lint job, which has no `pnpm install`.
 *
 * Usage: node tools/scripts/check-dependabot-coverage.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCKERFILE_RE = /(^|\/)Dockerfile[^/]*$/;
const COMPOSE_RE = /(^|\/)docker-compose[^/]*\.ya?ml$/;

function unquote(s) {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

/** Parses update entries: [{ ecosystem, directories: string[] }]. */
export function parseDependabot(text) {
  const entries = [];
  let current = null;
  let inDirs = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    const eco = /^\s*-\s+package-ecosystem:\s*(\S+)\s*$/.exec(line);
    if (eco) {
      current = { ecosystem: unquote(eco[1]), directories: [] };
      entries.push(current);
      inDirs = false;
      continue;
    }
    if (!current) continue;
    const single = /^\s+directory:\s*(\S+)\s*$/.exec(line);
    if (single) {
      current.directories.push(unquote(single[1]));
      inDirs = false;
      continue;
    }
    const multi = /^\s+directories:\s*(.*)$/.exec(line);
    if (multi) {
      const inline = multi[1].trim();
      if (inline.startsWith('[')) {
        for (const d of inline.replace(/^\[|\]$/g, '').split(',')) {
          if (d.trim()) current.directories.push(unquote(d));
        }
        inDirs = false;
      } else {
        inDirs = true;
      }
      continue;
    }
    const item = /^\s+-\s+(\S+)\s*$/.exec(line);
    if (inDirs && item) {
      current.directories.push(unquote(item[1]));
      continue;
    }
    if (line.trim() !== '') inDirs = false;
  }
  return entries;
}

/** Matches a repo directory ('' = root) against a Dependabot directory glob. */
export function dirMatches(glob, dir) {
  const g = glob.replace(/^\/+|\/+$/g, '');
  const d = dir.replace(/^\/+|\/+$/g, '');
  const pattern = g
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg === '**'
        ? '.*'
        : seg
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`).test(d);
}

/** Pure check. Returns error strings. */
export function checkCoverage(entries, files) {
  const errors = [];
  const needs = [
    { ecosystem: 'docker', re: DOCKERFILE_RE, kind: 'Dockerfile' },
    { ecosystem: 'docker-compose', re: COMPOSE_RE, kind: 'compose file' },
  ];
  for (const { ecosystem, re, kind } of needs) {
    const globs = entries.filter((e) => e.ecosystem === ecosystem).flatMap((e) => e.directories);
    const dirs = [
      ...new Set(files.filter((f) => re.test(f)).map((f) => (f.includes('/') ? dirname(f) : ''))),
    ];
    for (const dir of dirs.sort()) {
      if (!globs.some((g) => dirMatches(g, dir))) {
        errors.push(`${kind} directory /${dir} is not covered by a ${ecosystem} Dependabot entry`);
      }
    }
  }
  return errors;
}

function main() {
  const text = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const errors = checkCoverage(parseDependabot(text), files);
  if (errors.length > 0) {
    console.error('check-dependabot-coverage: FAIL');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(
    'check-dependabot-coverage: PASS (every Dockerfile and compose directory is covered)',
  );
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  process.exit(main());
}
