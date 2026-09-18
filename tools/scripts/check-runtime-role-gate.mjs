#!/usr/bin/env node
/**
 * W1-DATA-01 — Static contract: deploy/CI must require a live runtime-role gate
 * against the actual DATABASE_URL secret (not advisory-only docs).
 *
 * Usage:
 *   node tools/scripts/check-runtime-role-gate.mjs
 *   node tools/scripts/check-runtime-role-gate.mjs --root=/path/to/repo
 *   node tools/scripts/check-runtime-role-gate.mjs --json
 */
import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseDocument } from 'yaml';

export const ASSERT_JS_REL = 'tools/scripts/assert-runtime-database-role.mjs';
export const ASSERT_SH_REL = 'tools/scripts/assert-runtime-database-role.sh';
export const DEPLOY_WF_REL = '.github/workflows/deploy.yml';
export const CI_WF_REL = '.github/workflows/ci.yml';
export const AUDIT_DOC_REL = 'docs/audits/DATA_W1_DATA_01_COMPLETE.md';
export const PROD_ES_REL = 'infrastructure/k8s/overlays/production/external-secret.yaml';
export const STAGING_ES_REL = 'infrastructure/k8s/overlays/staging/external-secret.yaml';
export const HELM_VALUES_REL = 'infrastructure/helm/proctira-platform/values.yaml';
export const HELM_PROD_REL = 'infrastructure/helm/proctira-platform/values-production.yaml';
export const DB_README_REL = 'db/README.md';

/**
 * @param {string} root
 */
export function defaultPaths(root) {
  return {
    assertJs: join(root, ASSERT_JS_REL),
    assertSh: join(root, ASSERT_SH_REL),
    deployWf: join(root, DEPLOY_WF_REL),
    ciWf: join(root, CI_WF_REL),
    auditDoc: join(root, AUDIT_DOC_REL),
    prodEs: join(root, PROD_ES_REL),
    stagingEs: join(root, STAGING_ES_REL),
    helmValues: join(root, HELM_VALUES_REL),
    helmProd: join(root, HELM_PROD_REL),
    dbReadme: join(root, DB_README_REL),
  };
}

/**
 * @param {string} path
 */
function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * @param {string} text
 * @param {string} pathHint
 */
export function assertScriptContract(text, pathHint) {
  const issues = [];
  if (!text) {
    issues.push(`${pathHint} missing`);
    return issues;
  }
  if (!/W1-DATA-01/.test(text)) {
    issues.push(`${pathHint} must reference W1-DATA-01`);
  }
  if (!/RUNTIME_ROLE_GATE_REQUIRED/.test(text)) {
    issues.push(`${pathHint} must honor RUNTIME_ROLE_GATE_REQUIRED fail-closed`);
  }
  if (!/rolsuper|NOSUPERUSER/i.test(text)) {
    issues.push(`${pathHint} must assert non-superuser`);
  }
  if (!/rolbypassrls|NOBYPASSRLS|BYPASSRLS/i.test(text)) {
    issues.push(`${pathHint} must assert NOBYPASSRLS`);
  }
  if (!/owned_table|owns .* table|ownedTableCount/i.test(text)) {
    issues.push(`${pathHint} must assert zero application table ownership`);
  }
  if (!/owner_role_member|owner-role|pg_auth_members/i.test(text)) {
    issues.push(`${pathHint} must assert non-membership in owner roles`);
  }
  if (!/proctira_app/.test(text)) {
    issues.push(`${pathHint} must reference proctira_app`);
  }
  return issues;
}

function parseWorkflow(text, label, issues) {
  const document = parseDocument(text, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    for (const error of document.errors) issues.push(`${label} YAML: ${error.message}`);
    return null;
  }
  const value = document.toJS({ mapAsMap: false });
  if (!value || typeof value !== 'object') {
    issues.push(`${label} must be a YAML mapping`);
    return null;
  }
  return value;
}

function workflowJobs(workflow) {
  const jobs = workflow.jobs;
  return jobs && typeof jobs === 'object' ? jobs : workflow;
}

function jobNeeds(job, dependency) {
  const needs = job?.needs;
  if (typeof needs === 'string') return needs === dependency;
  return Array.isArray(needs) && needs.includes(dependency);
}

function jobSteps(job) {
  return Array.isArray(job?.steps)
    ? job.steps.filter((step) => step && typeof step === 'object')
    : [];
}

function errorToleranceDisabled(value) {
  return value === undefined || value === false;
}

function inheritedShellIsSafe(workflow, job) {
  return workflow?.defaults?.run?.shell === undefined && job?.defaults?.run?.shell === undefined;
}

function hasHardFailStep(workflow, job, expectedCommand) {
  if (!errorToleranceDisabled(job?.['continue-on-error']) || !inheritedShellIsSafe(workflow, job)) {
    return false;
  }
  return jobSteps(job).some(
    (step) =>
      typeof step.run === 'string' &&
      step.run.trim() === expectedCommand &&
      step.if === undefined &&
      errorToleranceDisabled(step['continue-on-error']) &&
      step.shell === undefined,
  );
}

function jobIsDisabled(job) {
  const condition = job?.if;
  return (
    condition === false ||
    (typeof condition === 'string' && /^\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/i.test(condition))
  );
}

/**
 * Deploy workflow must run the live gate against the runtime secret.
 * @param {string} text
 */
export function deployWorkflowContract(text) {
  const issues = [];
  if (!text) {
    issues.push('deploy.yml missing');
    return issues;
  }

  const workflow = parseWorkflow(text, 'deploy.yml', issues);
  if (!workflow) return issues;
  const jobs = workflowJobs(workflow);
  const migrationJob = jobs['migrate-database'];
  const runtimeJob = jobs['runtime-role-gate'];
  const deployJob = jobs.deploy;

  if (!migrationJob || jobIsDisabled(migrationJob)) {
    issues.push('deploy.yml must define an enabled migrate-database job before rollout');
  }
  if (
    !hasHardFailStep(workflow, migrationJob, 'bash tools/scripts/run-target-database-migrations.sh')
  ) {
    issues.push('migrate-database must run an unconditional hard-fail target migration step');
  }
  if (!JSON.stringify(migrationJob ?? {}).includes('${{ secrets.MIGRATOR_DATABASE_URL }}')) {
    issues.push('migrate-database must use the separately scoped MIGRATOR_DATABASE_URL secret');
  }

  if (!runtimeJob || jobIsDisabled(runtimeJob)) {
    issues.push('deploy.yml must define an enabled runtime-role-gate job (W1-DATA-01)');
  }
  if (
    !hasHardFailStep(workflow, runtimeJob, 'bash tools/scripts/assert-runtime-database-role.sh')
  ) {
    issues.push('runtime-role-gate must run an unconditional hard-fail database-role step');
  }
  if (!hasHardFailStep(workflow, runtimeJob, 'bash tools/scripts/assert-runtime-schema-ready.sh')) {
    issues.push('runtime-role-gate must run an unconditional hard-fail schema-ready step');
  }
  if (!JSON.stringify(runtimeJob ?? {}).includes('RUNTIME_ROLE_GATE_REQUIRED')) {
    issues.push('deploy.yml must set RUNTIME_ROLE_GATE_REQUIRED for the live gate');
  }
  if (!JSON.stringify(runtimeJob ?? {}).match(/DATABASE_URL|RUNTIME_ROLE_SECRET_NAME/)) {
    issues.push('deploy.yml runtime gate must bind the actual runtime DATABASE_URL secret');
  }
  if (!jobNeeds(runtimeJob, 'migrate-database')) {
    issues.push('runtime-role-gate must depend on migrate-database');
  }

  if (!deployJob || jobIsDisabled(deployJob)) {
    issues.push('deploy.yml must define an enabled deploy job');
  }
  if (!jobNeeds(deployJob, 'migrate-database') || !jobNeeds(deployJob, 'runtime-role-gate')) {
    issues.push('deploy job must depend on migration and runtime schema/role gates');
  }
  const deployCondition = typeof deployJob?.if === 'string' ? deployJob.if : '';
  for (const dependency of ['build-images', 'migrate-database', 'runtime-role-gate']) {
    const escaped = dependency.replaceAll('-', '\\-');
    if (
      !new RegExp(`needs\\.${escaped}\\.result\\s*==\\s*['\"]success['\"]`).test(deployCondition)
    ) {
      issues.push(`deploy job must explicitly require ${dependency}.result == 'success'`);
    }
  }
  if (/\b(?:always|cancelled|failure)\s*\(/.test(deployCondition)) {
    issues.push('deploy job must not use status functions that override dependency success');
  }
  for (const [name, job] of [
    ['migrate-database', migrationJob],
    ['runtime-role-gate', runtimeJob],
  ]) {
    if (
      !errorToleranceDisabled(job?.['continue-on-error']) ||
      !inheritedShellIsSafe(workflow, job) ||
      (typeof job?.if === 'string' && /\b(?:always|cancelled|failure)\s*\(/.test(job.if))
    ) {
      issues.push(
        `${name} must not mask failures through tolerance, inherited shells, or status functions`,
      );
    }
  }
  return issues;
}

/**
 * CI must keep a required static gate so wiring cannot regress.
 * @param {string} text
 */
export function ciWorkflowContract(text) {
  const issues = [];
  if (!text) {
    issues.push('ci.yml missing');
    return issues;
  }

  const workflow = parseWorkflow(text, 'ci.yml', issues);
  if (!workflow) return issues;
  const jobs = workflowJobs(workflow);
  const roleJob = jobs['runtime-role-gate'];
  const aggregateJob = jobs['ci-aggregate'];

  if (!roleJob || jobIsDisabled(roleJob)) {
    issues.push('ci.yml must define an enabled runtime-role-gate job (W1-DATA-01)');
  }
  for (const [command, message] of [
    ['pnpm install --frozen-lockfile', 'install dependencies for AST inspection'],
    ['node --test tools/scripts/check-no-runtime-ddl.test.mjs', 'unit-test the runtime-DDL gate'],
    [
      'node --test tools/scripts/target-database-migration-contract.test.mjs',
      'unit-test the target migration contract',
    ],
    ['node tools/scripts/check-runtime-role-gate.mjs', 'run check-runtime-role-gate.mjs'],
    ['node tools/scripts/check-no-runtime-ddl.mjs', 'run check-no-runtime-ddl.mjs'],
  ]) {
    if (!hasHardFailStep(workflow, roleJob, command)) {
      issues.push(`runtime-role-gate job must ${message} in an unconditional hard-fail step`);
    }
  }

  if (!aggregateJob || jobIsDisabled(aggregateJob)) {
    issues.push('ci.yml must define an enabled ci-aggregate job');
    return issues;
  }
  if (!jobNeeds(aggregateJob, 'runtime-role-gate')) {
    issues.push('ci-aggregate must need runtime-role-gate (required, not advisory)');
  }
  if (!JSON.stringify(aggregateJob).match(/RUNTIME_ROLE_GATE_RESULT|runtimeRoleGate/)) {
    issues.push('ci-aggregate must receive the runtime-role-gate result');
  }
  return issues;
}

/**
 * ExternalSecret / Helm must document DATABASE_URL → proctira_app.
 * @param {{ prodEs: string, stagingEs: string, helmValues: string, helmProd: string, dbReadme: string }} docs
 */
export function secretDocsContract(docs) {
  const issues = [];
  for (const [label, text] of [
    ['production ExternalSecret', docs.prodEs],
    ['staging ExternalSecret', docs.stagingEs],
  ]) {
    if (!text) {
      issues.push(`${label} missing`);
      continue;
    }
    if (!/DATABASE_URL/.test(text)) {
      issues.push(`${label} must map DATABASE_URL`);
    }
    if (!/proctira_app/.test(text)) {
      issues.push(`${label} must document DATABASE_URL → proctira_app (non-owner runtime)`);
    }
    if (!/W1-DATA-01/.test(text)) {
      issues.push(`${label} must cite W1-DATA-01`);
    }
  }

  if (!docs.helmValues) {
    issues.push('Helm values.yaml missing');
  } else {
    if (!/proctira_app/.test(docs.helmValues)) {
      issues.push('Helm values.yaml must document DATABASE_URL as proctira_app runtime role');
    }
    if (!/W1-DATA-01/.test(docs.helmValues)) {
      issues.push('Helm values.yaml must cite W1-DATA-01 for DATABASE_URL');
    }
  }

  if (!docs.helmProd) {
    issues.push('values-production.yaml missing');
  } else if (!/proctira_app|W1-DATA-01/.test(docs.helmProd)) {
    issues.push(
      'values-production.yaml must document existingSecret DATABASE_URL → proctira_app (W1-DATA-01)',
    );
  }

  if (!docs.dbReadme) {
    issues.push('db/README.md missing');
  } else if (!/assert-runtime-database-role/.test(docs.dbReadme)) {
    issues.push('db/README.md must document assert-runtime-database-role deploy gate');
  }

  return issues;
}

/**
 * @param {string} text
 */
export function auditDocContract(text) {
  const issues = [];
  if (!text) {
    issues.push('docs/audits/DATA_W1_DATA_01_COMPLETE.md missing');
    return issues;
  }
  if (!/W1-DATA-01/.test(text)) {
    issues.push('audit doc must reference W1-DATA-01');
  }
  if (!/COMPLETE|Complete/.test(text)) {
    issues.push('audit doc must mark COMPLETE');
  }
  if (!/assert-runtime-database-role/.test(text)) {
    issues.push('audit doc must reference assert-runtime-database-role');
  }
  if (!/ExternalSecret|proctira_app/.test(text)) {
    issues.push('audit doc must document ExternalSecret → proctira_app');
  }
  return issues;
}

/**
 * @param {string} root
 */
export function evaluateRuntimeRoleGate(root) {
  const paths = defaultPaths(root);
  const issues = [
    ...assertScriptContract(readText(paths.assertJs), ASSERT_JS_REL),
    ...assertScriptContract(readText(paths.assertSh), ASSERT_SH_REL),
    ...deployWorkflowContract(readText(paths.deployWf)),
    ...ciWorkflowContract(readText(paths.ciWf)),
    ...secretDocsContract({
      prodEs: readText(paths.prodEs),
      stagingEs: readText(paths.stagingEs),
      helmValues: readText(paths.helmValues),
      helmProd: readText(paths.helmProd),
      dbReadme: readText(paths.dbReadme),
    }),
    ...auditDocContract(readText(paths.auditDoc)),
  ];

  try {
    accessSync(paths.assertSh, constants.X_OK);
  } catch {
    issues.push(`${ASSERT_SH_REL} must be executable`);
  }

  return {
    ok: issues.length === 0,
    issues,
    paths,
  };
}

function parseRoot(argv) {
  const flag = argv.find((a) => a.startsWith('--root='));
  if (flag) return flag.slice('--root='.length);
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const report = evaluateRuntimeRoleGate(root);
  const asJson = process.argv.includes('--json');
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log('check-runtime-role-gate: PASS');
  } else {
    console.error('check-runtime-role-gate: FAIL');
    for (const issue of report.issues) {
      console.error(`  - ${issue}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirect) {
  main();
}
