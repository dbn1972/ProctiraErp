#!/usr/bin/env node
/**
 * PRC-L308 — CI tool downloads must be integrity-checked.
 *
 * For every `run:` block in .github/workflows/*.yml that downloads an archive,
 * binary or key with curl/wget (a `releases/download/` URL or a URL ending in
 * .tar.gz/.tgz/.tar/.zip/.gz/.deb/.bin/.asc/.gpg/.key), the same block must:
 *   - write the download to a file (never pipe it straight into tar/sh/bash/gpg);
 *   - for archives/binaries: run `sha256sum -c` against a `*_SHA256` variable
 *     whose value in the workflow `env:` is a committed 64-hex literal;
 *   - for keys (.asc/.gpg/.key): check `gpg --show-keys` output against a
 *     `*_FINGERPRINT` variable whose value is a committed 40-hex literal.
 *
 * Dependency-free (node: built-ins only, line scan) because it runs in the
 * workflow-lint job, which has no `pnpm install`.
 *
 * Usage: node tools/scripts/check-ci-download-integrity.mjs [--root <dir>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACT_URL = /releases\/download\/|\.(?:tar\.gz|tgz|tar|zip|gz|deb|bin|asc|gpg|key)\b/;
const KEY_URL = /\.(?:asc|gpg|key)\b/;
const FETCH = /\b(curl|wget)\b/;

/** Splits a workflow into run-script blocks: [{ line, text }]. */
export function runBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[2].trim();
    if (rest !== '' && !/^[|>][-+]?$/.test(rest)) {
      blocks.push({ line: i + 1, text: rest });
      continue;
    }
    const keyIndent = m[1].length + (lines[i].trimStart().startsWith('-') ? 2 : 0);
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j];
      if (l.trim() !== '' && l.length - l.trimStart().length <= keyIndent) break;
      body.push(l);
    }
    blocks.push({ line: i + 1, text: body.join('\n') });
  }
  return blocks;
}

/** Collects committed env literals: { sha: Map(name->hex64), fpr: Map(name->hex40) }. */
export function envLiterals(text) {
  const sha = new Map();
  const fpr = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s+([A-Z][A-Z0-9_]*):\s*['"]?([0-9A-Fa-f]+)['"]?\s*(?:#.*)?$/.exec(raw);
    if (!m) continue;
    if (/_SHA256$/.test(m[1]) && /^[0-9a-f]{64}$/.test(m[2])) sha.set(m[1], m[2]);
    if (/_FINGERPRINT$/.test(m[1]) && /^[0-9A-F]{40}$/i.test(m[2])) fpr.set(m[1], m[2]);
  }
  return { sha, fpr };
}

/** Joins backslash-continued shell lines into logical commands. */
function commands(script) {
  return script
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*#.*$/, '').trim())
    .filter(Boolean);
}

function referencesVar(script, names) {
  return [...names].some((n) => new RegExp(`\\$\\{?${n}\\b`).test(script));
}

/** Pure check for one workflow. Returns error strings. */
export function checkWorkflow(file, text) {
  const errors = [];
  const { sha, fpr } = envLiterals(text);
  for (const block of runBlocks(text)) {
    const cmds = commands(block.text);
    const downloads = cmds.filter((c) => FETCH.test(c) && ARTIFACT_URL.test(c));
    if (downloads.length === 0) continue;
    for (const c of downloads) {
      if (/\|\s*(?:sudo\s+)?(?:tar|sh|bash|gpg|apt-key)\b/.test(c)) {
        errors.push(
          `${file}:${block.line} download is piped straight into an unpacker/shell: ${c}`,
        );
      }
    }
    const needsKey = downloads.some((c) => KEY_URL.test(c));
    const needsSha = downloads.some((c) => !KEY_URL.test(c));
    if (
      needsSha &&
      !(/\bsha256sum\s+(?:--check|-c)\b/.test(block.text) && referencesVar(block.text, sha.keys()))
    ) {
      errors.push(
        `${file}:${block.line} downloads an artifact without sha256sum -c against a committed *_SHA256 env literal`,
      );
    }
    if (
      needsKey &&
      !(/\bgpg\s+--show-keys\b/.test(block.text) && referencesVar(block.text, fpr.keys()))
    ) {
      errors.push(
        `${file}:${block.line} downloads a signing key without a pinned *_FINGERPRINT check (gpg --show-keys)`,
      );
    }
  }
  return errors;
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;
  const dir = join(root, '.github/workflows');
  const errors = [];
  let scanned = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    scanned += 1;
    errors.push(...checkWorkflow(name, readFileSync(join(dir, name), 'utf8')));
  }
  if (errors.length > 0) {
    console.error('check-ci-download-integrity: FAIL');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(`check-ci-download-integrity: PASS (${scanned} workflows scanned)`);
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  process.exit(main(process.argv.slice(2)));
}
