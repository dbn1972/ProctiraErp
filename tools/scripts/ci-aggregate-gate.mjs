#!/usr/bin/env node
/**
 * CI aggregate gate (W1-OPS-05 B2).
 *
 * Validates upstream CI job results against detect-changes outputs. Fails closed
 * when any required job failed/cancelled, or when a job was skipped without a
 * proven path-filter justification (skip cascade).
 *
 * Usage: node tools/scripts/ci-aggregate-gate.mjs
 * Env: see evaluate() inputs — wired from ci.yml needs.*.result outputs.
 */
import { appendFileSync } from 'node:fs';

const TRUTHY = new Set(['true', '1', 'yes']);

function truthy(value) {
  return TRUTHY.has(String(value ?? '').toLowerCase());
}

function codeChanged(changes) {
  return (
    truthy(changes.packagesChanged) ||
    truthy(changes.appsChanged) ||
    truthy(changes.sharedChanged)
  );
}

function frontendGate(changes) {
  return truthy(changes.frontendChanged) || truthy(changes.sharedChanged);
}

function backendGate(changes) {
  return truthy(changes.backendChanged) || truthy(changes.sharedChanged);
}

/**
 * @param {{
 *   changes: Record<string, string | undefined>,
 *   results: Record<string, string | undefined>,
 * }} input
 */
export function evaluate({ changes, results }) {
  const report = {
    ok: true,
    failures: [],
    unprovenSkips: [],
    provenSkips: [],
    successes: [],
  };

  const detectResult = results.detectChanges ?? 'unknown';
  if (detectResult !== 'success') {
    report.ok = false;
    report.failures.push({
      job: 'detect-changes',
      result: detectResult,
      reason: 'change detection must succeed before CI can be certified',
    });
    return report;
  }

  const gates = [
    { job: 'lint', result: results.lint, requiredWhen: () => codeChanged(changes) },
    { job: 'typecheck', result: results.typecheck, requiredWhen: () => codeChanged(changes) },
    { job: 'unit-test', result: results.unitTest, requiredWhen: () => codeChanged(changes) },
    { job: 'build', result: results.build, requiredWhen: () => codeChanged(changes) },
    {
      job: 'bundle-budget',
      result: results.bundleBudget,
      requiredWhen: () => frontendGate(changes),
    },
    { job: 'lighthouse', result: results.lighthouse, requiredWhen: () => frontendGate(changes) },
    {
      job: 'integration-test',
      result: results.integrationTest,
      requiredWhen: () => backendGate(changes),
    },
    { job: 'dod-checks', result: results.dodChecks, requiredWhen: () => codeChanged(changes) },
    {
      job: 'tenant-isolation',
      result: results.tenantIsolation,
      requiredWhen: () => codeChanged(changes),
    },
  ];

  for (const gate of gates) {
    const result = gate.result ?? 'unknown';
    const required = gate.requiredWhen();

    if (result === 'failure' || result === 'cancelled') {
      report.ok = false;
      report.failures.push({
        job: gate.job,
        result,
        reason: 'job did not succeed',
      });
      continue;
    }

    if (result === 'success') {
      report.successes.push({ job: gate.job, required });
      continue;
    }

    if (result === 'skipped') {
      if (required) {
        report.ok = false;
        report.unprovenSkips.push({
          job: gate.job,
          reason: 'skipped while path filters require this job (possible skip cascade)',
        });
      } else {
        report.provenSkips.push({ job: gate.job, reason: 'path filters did not require this job' });
      }
      continue;
    }

    report.ok = false;
    report.failures.push({
      job: gate.job,
      result,
      reason: 'unexpected job result',
    });
  }

  return report;
}

function formatSummary(report) {
  const lines = ['## CI Aggregate Gate (W1-OPS-05 B2)', ''];
  if (report.ok) {
    lines.push('**Status:** pass — all required jobs succeeded or skips are proven.');
  } else {
    lines.push('**Status:** fail — closed gate blocked merge certification.');
  }
  lines.push('');

  if (report.failures.length) {
    lines.push('### Failures');
    for (const item of report.failures) {
      lines.push(`- \`${item.job}\`: ${item.result} — ${item.reason}`);
    }
    lines.push('');
  }

  if (report.unprovenSkips.length) {
    lines.push('### Unproven skips (fail closed)');
    for (const item of report.unprovenSkips) {
      lines.push(`- \`${item.job}\`: ${item.reason}`);
    }
    lines.push('');
  }

  if (report.provenSkips.length) {
    lines.push('### Proven skips');
    for (const item of report.provenSkips) {
      lines.push(`- \`${item.job}\`: ${item.reason}`);
    }
    lines.push('');
  }

  if (report.successes.length) {
    lines.push('### Successful jobs');
    for (const item of report.successes) {
      lines.push(`- \`${item.job}\`${item.required ? ' (required)' : ' (optional run)'}`);
    }
  }

  return lines.join('\n');
}

function readEnv() {
  return {
    changes: {
      packagesChanged: process.env.PACKAGES_CHANGED,
      appsChanged: process.env.APPS_CHANGED,
      sharedChanged: process.env.SHARED_CHANGED,
      frontendChanged: process.env.FRONTEND_CHANGED,
      backendChanged: process.env.BACKEND_CHANGED,
    },
    results: {
      detectChanges: process.env.DETECT_CHANGES_RESULT,
      lint: process.env.LINT_RESULT,
      typecheck: process.env.TYPECHECK_RESULT,
      unitTest: process.env.UNIT_TEST_RESULT,
      build: process.env.BUILD_RESULT,
      bundleBudget: process.env.BUNDLE_BUDGET_RESULT,
      lighthouse: process.env.LIGHTHOUSE_RESULT,
      integrationTest: process.env.INTEGRATION_TEST_RESULT,
      dodChecks: process.env.DOD_CHECKS_RESULT,
      tenantIsolation: process.env.TENANT_ISOLATION_RESULT,
    },
  };
}

function main() {
  const report = evaluate(readEnv());
  const summary = formatSummary(report);
  console.log(summary);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${summary}\n`);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
