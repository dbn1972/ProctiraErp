#!/usr/bin/env node
/**
 * Enterprise production-ready test gate for ProctiraErp.
 *
 * sessionStart        → inject skill pointer
 * beforeSubmitPrompt  → activate enterprise-test session on test intents
 * stop                → follow up until pillars have evidence or waiver
 * beforeShellExecution→ remind when commits happen mid-session
 *
 * State: .cursor/hooks/state/enterprise-test-session.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, '.cursor/hooks/state');
const STATE_FILE = path.join(STATE_DIR, 'enterprise-test-session.json');
const SKILL = '.cursor/skills/enterprise-module-production-ready/SKILL.md';
const CHECKLIST_TEMPLATE =
  'docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md';

const TEST_INTENT =
  /\b(e2e|end[\s-]?to[\s-]?end|full\s+test|production[\s-]?ready|enterprise|world[\s-]?class|multidevice|multi[\s-]?device|ux\s+test|a11y|accessib|security\s+test|tenant\s+isolation|audit\s+(health|scholarship)|fully\s+test|test\s+hooks)\b/i;

const MODULE_HINTS = [
  {
    id: 'health',
    re: /\bhealth\b|\bscreenings?\b|\bcounselling\b|\bcounseling\b|\bspecial\s+needs\b/,
  },
  { id: 'scholarships', re: /\bscholarships?\b|\bdisbursements?\b/ },
  { id: 'academics', re: /\bacademics?\b|\battendance\b|\benrol+ments?\b/ },
];

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function detectModules(text) {
  const found = [];
  for (const m of MODULE_HINTS) {
    if (m.re.test(text)) found.push(m.id);
  }
  return found;
}

function findAuditDocs(modules) {
  const dir = path.join(ROOT, 'docs/audits');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  if (!modules.length) {
    return files
      .filter((f) => /HEALTH|SCHOLARSHIP|ENTERPRISE/i.test(f))
      .map((f) => path.join('docs/audits', f));
  }
  return files
    .filter((f) =>
      modules.some((m) => f.toLowerCase().includes(m.replace(/s$/, ''))),
    )
    .map((f) => path.join('docs/audits', f));
}

function findE2ESpecs(modules) {
  const dir = path.join(ROOT, 'apps/web/e2e');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
  if (!modules.length) return [];
  return files
    .filter((f) =>
      modules.some((m) => f.toLowerCase().includes(m.replace(/s$/, ''))),
    )
    .map((f) => path.join('apps/web/e2e', f));
}

function hasArtifactEvidence() {
  const candidates = [
    '/opt/cursor/artifacts',
    path.join(ROOT, 'apps/web/screens'),
    path.join(ROOT, 'apps/web/test-results'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const walk = (d, depth) => {
        if (depth > 3) return false;
        for (const name of fs.readdirSync(d)) {
          const full = path.join(d, name);
          const st = fs.statSync(full);
          if (st.isFile() && /\.(png|jpg|webm|mp4)$/i.test(name)) return true;
          if (st.isDirectory() && walk(full, depth + 1)) return true;
        }
        return false;
      };
      if (walk(p, 0)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function scoreCompleteness(state) {
  const modules = state.modules || [];
  const audits = findAuditDocs(modules);
  const specs = findE2ESpecs(modules);
  const hasArtifacts = hasArtifactEvidence();
  const gaps = [];

  if (!audits.length) {
    gaps.push(
      `Create audit from ${CHECKLIST_TEMPLATE} covering E2E, UX, multidevice, functionality, security`,
    );
  }
  if (modules.includes('health') && !specs.some((s) => /health/i.test(s))) {
    gaps.push(
      'Add apps/web/e2e Playwright journey for Health (screenings, student profile, counselling, special needs)',
    );
  }
  if (
    modules.includes('scholarships') &&
    !specs.some((s) => /scholarship/i.test(s))
  ) {
    gaps.push('Add or extend apps/web/e2e scholarships Playwright coverage');
  }
  if (!hasArtifacts) {
    gaps.push(
      'Capture desktop/tablet/mobile screenshots (apps/web/scripts/capture-screens.mjs → apps/web/screens/ or /opt/cursor/artifacts)',
    );
  }
  const pillars = state.pillars || {};
  for (const key of [
    'functionality',
    'e2e',
    'ux',
    'multidevice',
    'security',
    'ci',
  ]) {
    if (!pillars[key]) {
      gaps.push(
        `Set pillars.${key}=true in ${path.relative(ROOT, STATE_FILE)} after evidence exists (or document a waiver in the audit)`,
      );
    }
  }

  return { gaps, audits, specs, hasArtifacts };
}

function skillContext(extra) {
  return [
    'ENTERPRISE PRODUCTION-READY TEST POLICY (project hooks active).',
    `Mandatory skill: ${SKILL}`,
    `Checklist template: ${CHECKLIST_TEMPLATE}`,
    'Pillars required before claiming done: Functionality, E2E (live when possible), UX/a11y, Multidevice captures, Security/tenant/RBAC, CI gates, Evidence pack.',
    'Do not equate route-smoke or skipped Playwright with enterprise production-ready.',
    extra || '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function sessionStart(input) {
  const state = loadState();
  const active = state && state.active && state.status !== 'complete';
  out({
    additional_context: skillContext(
      active
        ? `Active enterprise-test session for modules: ${(state.modules || []).join(', ') || 'unspecified'}. Continue until checklist complete.`
        : 'When the user asks for full/E2E/enterprise testing, read the skill and complete every pillar with evidence.',
    ),
  });
}

async function beforeSubmitPrompt(input) {
  const prompt = String(input.prompt || '');
  if (!TEST_INTENT.test(prompt) && !detectModules(prompt).length) {
    out({ continue: true });
    return;
  }

  const modules = detectModules(prompt);
  const prev = loadState() || {};
  const next = {
    active: true,
    status: 'in_progress',
    startedAt: prev.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modules: [...new Set([...(prev.modules || []), ...modules])],
    pillars: prev.pillars || {
      functionality: false,
      e2e: false,
      ux: false,
      multidevice: false,
      security: false,
      ci: false,
    },
    lastPromptExcerpt: prompt.slice(0, 240),
  };
  saveState(next);

  out({
    continue: true,
    user_message:
      'Enterprise test hooks armed. Agent must follow .cursor/skills/enterprise-module-production-ready/SKILL.md (E2E, UX, multidevice, functionality, security) and fill docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md before claiming production-ready.',
  });
}

async function stop(input) {
  const state = loadState();
  if (!state || !state.active || state.status === 'complete') {
    out({});
    return;
  }
  if (input.status === 'aborted') {
    out({});
    return;
  }

  const loopCount = Number(input.loop_count || 0);
  const fresh = loadState();
  if (fresh && fresh.status === 'complete') {
    out({});
    return;
  }

  const { gaps } = scoreCompleteness(fresh || state);
  if (gaps.length === 0) {
    saveState({
      ...(fresh || state),
      status: 'complete',
      completedAt: new Date().toISOString(),
    });
    out({});
    return;
  }

  const body = [
    'Enterprise production-ready gate: session still incomplete.',
    `Modules: ${(state.modules || []).join(', ') || '(detect from nav / user request)'}`,
    `Read and follow ${SKILL}`,
    'Remaining:',
    ...gaps.map((g) => `- ${g}`),
    loopCount >= 3
      ? 'Either finish remaining pillars with evidence, or document dated waivers in the audit markdown and set status to "complete" with a waiver note in the session JSON. Do not claim world-class production-ready until then.'
      : 'Continue testing now; update the audit checklist and session pillars as you finish each pillar.',
  ].join('\n');

  out({ followup_message: body });
}

async function beforeShellExecution(input) {
  const command = String(input.command || '');
  const state = loadState();
  if (!state || !state.active || state.status === 'complete') {
    out({ permission: 'allow' });
    return;
  }

  if (/\bgit\s+commit\b|\bgit\s+push\b/i.test(command)) {
    const { gaps } = scoreCompleteness(state);
    if (gaps.length) {
      out({
        permission: 'allow',
        agent_message:
          'Enterprise-test session still open with gaps:\n' +
          gaps.map((g) => `- ${g}`).join('\n') +
          '\nYou may commit incremental work, but do not claim enterprise production-ready until gaps are closed or waived in the audit doc.',
      });
      return;
    }
  }

  out({ permission: 'allow' });
}

async function main() {
  const hook = process.argv[2] || '';
  const input = await readStdin();
  switch (hook) {
    case 'sessionStart':
      await sessionStart(input);
      break;
    case 'beforeSubmitPrompt':
      await beforeSubmitPrompt(input);
      break;
    case 'stop':
      await stop(input);
      break;
    case 'beforeShellExecution':
      await beforeShellExecution(input);
      break;
    default:
      out({});
  }
}

main().catch((err) => {
  console.error(err);
  out({ continue: true, permission: 'allow' });
  process.exit(0);
});
