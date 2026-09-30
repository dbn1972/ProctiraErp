#!/usr/bin/env node
/**
 * PRC-L181 — YAML-backed, per-step fail-closed contracts for scanner and
 * image-signing workflows (replaces file-wide grep markers).
 *
 *   --scanners <security-scans.yml>   every scanner job/step must be blocking
 *   --cosign <workflow.yml>...        each workflow must install cosign and run
 *                                     blocking `cosign sign` + `cosign verify`
 *
 * Exits 1 on any violation, invalid YAML, or missing file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

/**
 * @param {string} text
 * @param {string} [label]
 */
export function loadWorkflow(text, label = 'workflow') {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(`${label}: invalid YAML — ${doc.errors[0].message}`);
  }
  const wf = doc.toJS();
  if (!wf || typeof wf !== 'object' || !wf.jobs || typeof wf.jobs !== 'object') {
    throw new Error(`${label}: no jobs mapping`);
  }
  return wf;
}

/** `continue-on-error` counts as soft unless absent or literally false. */
export function isSoftContinue(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') return false;
  return true;
}

/** Shell idioms that swallow a scanner's exit status. */
const SOFT_RUN_RE = /\|\|\s*(?:true|:|exit\s+0)\b|^\s*set\s+\+e\b/m;

/**
 * @param {Record<string, any>} step
 * @param {string} where
 * @returns {string[]}
 */
function blockingStepViolations(step, where) {
  const out = [];
  if (isSoftContinue(step['continue-on-error']))
    out.push(`${where}: continue-on-error must be false/absent`);
  if (step.if !== undefined) out.push(`${where}: must not be conditional (if: ${step.if})`);
  if (typeof step.run === 'string' && SOFT_RUN_RE.test(step.run)) {
    out.push(`${where}: run swallows exit status (|| true / set +e)`);
  }
  return out;
}

/**
 * Return each full shell command (joined `\` continuations, comments dropped)
 * that matches `re`, so flags are checked per invocation, not file-wide.
 * @param {string} run
 * @param {RegExp} re
 */
export function shellInvocations(run, re) {
  const cmds = [];
  let cur = '';
  for (const raw of run.split('\n')) {
    const line = raw.trim();
    if (!cur && line.startsWith('#')) continue;
    cur += ` ${line.replace(/\\$/, '')}`;
    if (!line.endsWith('\\')) {
      if (re.test(cur)) cmds.push(cur.trim());
      cur = '';
    }
  }
  if (cur && re.test(cur)) cmds.push(cur.trim());
  return cmds;
}
const TRIVY_USES = /^aquasecurity\/trivy-action@/;

export const SCANNERS = [
  {
    job: 'secret-scan',
    label: 'gitleaks',
    match: (s) => typeof s.run === 'string' && /\bgitleaks\s+detect\b/.test(s.run),
    check: (s) =>
      shellInvocations(s.run, /\bgitleaks\s+detect\b/).every((cmd) => /--exit-code\s+1\b/.test(cmd))
        ? []
        : ['every gitleaks detect invocation needs --exit-code 1'],
  },
  {
    job: 'sast-semgrep',
    label: 'semgrep',
    match: (s) => typeof s.run === 'string' && /\bsemgrep\s+scan\b/.test(s.run),
    check: (s) => (/(^|\s)--error\b/.test(s.run) ? [] : ['semgrep scan needs --error']),
  },
  {
    job: 'iac-trivy',
    label: 'trivy config',
    match: (s) => typeof s.uses === 'string' && TRIVY_USES.test(s.uses),
    check: (s) => trivyChecks(s, 'config'),
  },
  {
    job: 'container-fs-trivy',
    label: 'trivy fs',
    match: (s) => typeof s.uses === 'string' && TRIVY_USES.test(s.uses),
    check: (s) => trivyChecks(s, 'fs'),
  },
];

function trivyChecks(step, scanType) {
  const w = step.with ?? {};
  const out = [];
  if (String(w['exit-code'] ?? '') !== '1') out.push("trivy step needs with.exit-code: '1'");
  if (w['scan-type'] !== scanType) out.push(`trivy step needs scan-type: ${scanType}`);
  return out;
}

/**
 * @param {Record<string, any>} wf parsed security-scans workflow
 * @returns {string[]}
 */
export function scannerViolations(wf) {
  const out = [];
  // Workflow-wide: no job or step may soft-pass.
  for (const [jobId, job] of Object.entries(wf.jobs)) {
    if (isSoftContinue(job?.['continue-on-error'])) {
      out.push(`job ${jobId}: continue-on-error must be false/absent`);
    }
    (job?.steps ?? []).forEach((step, i) => {
      if (isSoftContinue(step?.['continue-on-error'])) {
        out.push(`job ${jobId} step ${step?.name ?? i}: continue-on-error must be false/absent`);
      }
    });
  }
  for (const scanner of SCANNERS) {
    const job = wf.jobs[scanner.job];
    if (!job) {
      out.push(`missing scanner job ${scanner.job}`);
      continue;
    }
    if (job.if !== undefined) out.push(`job ${scanner.job}: scanner job must not be conditional`);
    const steps = (job.steps ?? []).filter((s) => s && scanner.match(s));
    if (steps.length === 0) {
      out.push(`job ${scanner.job}: no ${scanner.label} step found`);
      continue;
    }
    for (const step of steps) {
      const where = `job ${scanner.job} step "${step.name ?? scanner.label}"`;
      out.push(...blockingStepViolations(step, where));
      out.push(...scanner.check(step).map((m) => `${where}: ${m}`));
    }
  }
  return out;
}

/**
 * @param {Record<string, any>} wf parsed release/supply-chain workflow
 * @returns {string[]}
 */
export function cosignViolations(wf) {
  const out = [];
  let installer = false;
  let sign = 0;
  let verify = 0;
  for (const [jobId, job] of Object.entries(wf.jobs)) {
    (job?.steps ?? []).forEach((step, i) => {
      if (!step) return;
      if (typeof step.uses === 'string' && step.uses.startsWith('sigstore/cosign-installer@')) {
        installer = true;
      }
      if (typeof step.run !== 'string') return;
      const isSign = /\bcosign\s+sign\b/.test(step.run);
      const isVerify = /\bcosign\s+verify\b/.test(step.run);
      if (!isSign && !isVerify) return;
      const where = `job ${jobId} step "${step.name ?? i}"`;
      out.push(...blockingStepViolations(step, where));
      if (isSoftContinue(job['continue-on-error'])) {
        out.push(`job ${jobId}: signing job must not set continue-on-error`);
      }
      if (isSign) sign += 1;
      if (isVerify) verify += 1;
    });
  }
  if (!installer) out.push('missing sigstore/cosign-installer step');
  if (sign === 0) out.push('missing blocking `cosign sign` step');
  if (verify === 0) out.push('missing blocking `cosign verify` step');
  return out;
}

function main(argv) {
  let mode = null;
  /** @type {{ mode: string, file: string }[]} */
  const targets = [];
  for (const arg of argv) {
    if (arg === '--scanners' || arg === '--cosign') mode = arg.slice(2);
    else if (mode) targets.push({ mode, file: arg });
    else throw new Error(`unexpected argument ${arg} (use --scanners/--cosign <file>)`);
  }
  if (targets.length === 0) throw new Error('no workflow files given');
  const failures = [];
  for (const { mode: m, file } of targets) {
    const abs = resolve(file);
    if (!existsSync(abs)) {
      failures.push(`${file}: missing`);
      continue;
    }
    const wf = loadWorkflow(readFileSync(abs, 'utf8'), file);
    const v = m === 'scanners' ? scannerViolations(wf) : cosignViolations(wf);
    failures.push(...v.map((x) => `${file}: ${x}`));
  }
  return failures;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  let failures;
  try {
    failures = main(process.argv.slice(2));
  } catch (err) {
    console.error(
      `check-workflow-step-contracts: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error('check-workflow-step-contracts: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-workflow-step-contracts: PASS');
}
