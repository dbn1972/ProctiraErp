#!/usr/bin/env node
/**
 * Supply-chain advisory gate (G-708).
 *
 * Runs `pnpm audit --prod --json`, drops advisories that are explicitly
 * allowlisted in `tools/supply-chain/audit-allowlist.json` (each entry needs a
 * GHSA id, a reason, an owner gap id and an expiry date), and exits non-zero
 * when any remaining advisory is at or above the configured severity.
 *
 * Expired allowlist entries are treated as *not* allowlisted, so a waiver
 * cannot silently outlive its review date.
 *
 * Usage: node tools/scripts/audit-gate.mjs [--level high|critical] [--out DIR]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function parseArgs(argv) {
  const out = { level: 'high', outDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--level') out.level = argv[++i];
    else if (argv[i] === '--out') out.outDir = argv[++i];
  }
  if (!(out.level in SEVERITY_RANK)) {
    throw new Error(`Unknown --level "${out.level}"`);
  }
  return out;
}

export function loadAllowlist(path, now = new Date()) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const active = new Map();
  const expired = [];
  for (const entry of raw.entries ?? []) {
    for (const key of ['ghsa', 'reason', 'trackedBy', 'expires']) {
      if (!entry[key]) throw new Error(`allowlist entry missing "${key}": ${JSON.stringify(entry)}`);
    }
    const expires = new Date(entry.expires);
    if (Number.isNaN(expires.getTime())) {
      throw new Error(`allowlist entry has invalid expires date: ${entry.ghsa}`);
    }
    if (expires.getTime() < now.getTime()) expired.push(entry);
    else active.set(entry.ghsa, entry);
  }
  return { active, expired };
}

export function evaluate(auditJson, allowlist, level) {
  const threshold = SEVERITY_RANK[level];
  const blocking = [];
  const waived = [];
  const belowThreshold = [];
  for (const adv of Object.values(auditJson.advisories ?? {})) {
    const rank = SEVERITY_RANK[adv.severity] ?? 0;
    const record = {
      ghsa: adv.github_advisory_id,
      module: adv.module_name,
      severity: adv.severity,
      vulnerable: adv.vulnerable_versions,
      patched: adv.patched_versions,
      title: adv.title,
    };
    if (rank < threshold) {
      belowThreshold.push(record);
      continue;
    }
    const waiver = allowlist.active.get(adv.github_advisory_id);
    if (waiver) {
      waived.push({ ...record, reason: waiver.reason, trackedBy: waiver.trackedBy, expires: waiver.expires });
    } else {
      blocking.push(record);
    }
  }
  return { blocking, waived, belowThreshold };
}

function runAudit() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // pnpm audit exits non-zero when advisories exist; the JSON is still on stdout.
  const stdout = (result.stdout ?? '').trim();
  if (!stdout.startsWith('{')) {
    throw new Error(`pnpm audit produced no JSON (exit ${result.status}):\n${result.stderr ?? stdout}`);
  }
  return JSON.parse(stdout);
}

function main() {
  const { level, outDir } = parseArgs(process.argv.slice(2));
  const allowlistPath = join(repoRoot, 'tools', 'supply-chain', 'audit-allowlist.json');
  const allowlist = loadAllowlist(allowlistPath);
  const audit = runAudit();
  const report = evaluate(audit, allowlist, level);

  const summary = {
    generatedAt: new Date().toISOString(),
    level,
    counts: audit.metadata?.vulnerabilities ?? {},
    blocking: report.blocking,
    waived: report.waived,
    expiredWaivers: allowlist.expired.map((e) => e.ghsa),
    belowThreshold: report.belowThreshold.length,
  };

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'pnpm-audit.json'), JSON.stringify(audit, null, 2));
    writeFileSync(join(outDir, 'audit-gate-summary.json'), JSON.stringify(summary, null, 2));
  }

  console.log(`audit-gate: level=${level} blocking=${report.blocking.length} waived=${report.waived.length} expiredWaivers=${allowlist.expired.length}`);
  for (const w of report.waived) {
    console.log(`  waived   ${w.ghsa} ${w.module}@${w.vulnerable} (${w.severity}) — ${w.trackedBy}, until ${w.expires}`);
  }
  for (const e of allowlist.expired) {
    console.log(`  EXPIRED  ${e.ghsa} — waiver lapsed on ${e.expires}; renew or fix`);
  }
  for (const b of report.blocking) {
    console.log(`  BLOCKING ${b.ghsa} ${b.module}@${b.vulnerable} (${b.severity}) → patched ${b.patched}`);
  }

  if (report.blocking.length > 0 || allowlist.expired.length > 0) {
    console.error('audit-gate: FAIL');
    process.exit(1);
  }
  console.log('audit-gate: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
