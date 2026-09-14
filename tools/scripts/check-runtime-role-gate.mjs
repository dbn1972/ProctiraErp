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
  if (!/runtime-role-gate:/.test(text) && !/Runtime DB role gate \(W1-DATA-01\)/.test(text)) {
    issues.push('deploy.yml must define a runtime-role-gate job (W1-DATA-01)');
  }
  if (!/assert-runtime-database-role\.sh/.test(text)) {
    issues.push('deploy.yml must invoke assert-runtime-database-role.sh');
  }
  if (!/RUNTIME_ROLE_GATE_REQUIRED/.test(text)) {
    issues.push('deploy.yml must set RUNTIME_ROLE_GATE_REQUIRED for the live gate');
  }
  // Must use the actual secret — GH env DATABASE_URL and/or cluster Secret.
  if (!/DATABASE_URL|RUNTIME_ROLE_SECRET_NAME|proctira-prod-secrets|proctira-secrets/.test(text)) {
    issues.push('deploy.yml runtime gate must bind the actual runtime DATABASE_URL secret');
  }
  // Soft advisory-only paths are forbidden.
  if (/::warning::.*runtime role|skipping runtime role/i.test(text)) {
    issues.push('deploy.yml must not greenwash the runtime role gate with ::warning:: skip');
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
  if (!/runtime-role-gate:/.test(text) && !/Runtime Role Gate \(W1-DATA-01\)/.test(text)) {
    issues.push('ci.yml must define runtime-role-gate job (W1-DATA-01)');
  }
  if (!/check-runtime-role-gate\.mjs/.test(text)) {
    issues.push('ci.yml must run check-runtime-role-gate.mjs');
  }
  if (!/ci-aggregate:/.test(text)) {
    issues.push('ci.yml missing ci-aggregate');
    return issues;
  }
  const aggregateBlock = text.match(/\n  ci-aggregate:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|$)/)?.[0] ?? '';
  if (!/runtime-role-gate/.test(aggregateBlock)) {
    issues.push('ci-aggregate must need runtime-role-gate (required, not advisory)');
  }
  if (!/RUNTIME_ROLE_GATE_RESULT|runtimeRoleGate/.test(text)) {
    issues.push('ci.yml must pass runtime-role-gate result into ci-aggregate-gate');
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
    issues.push('values-production.yaml must document existingSecret DATABASE_URL → proctira_app (W1-DATA-01)');
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

const isDirect =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirect) {
  main();
}
