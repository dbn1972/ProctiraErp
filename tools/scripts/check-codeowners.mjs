#!/usr/bin/env node
/**
 * W1-SEC-13 — CODEOWNERS fail-closed gate.
 *
 * Prevents silent fake @org/team handles on personal-account repos (GitHub
 * ignores unknown teams without failing the file) and requires an explicit
 * org readiness flag before team ownership is treated as complete.
 *
 * Modes (env):
 *   PROCTIRA_CODEOWNERS_TEAMS_READY=1
 *     Specialist paths MUST be owned by @org/team handles (not personal-only).
 *   Otherwise (personal-account / pre-cutover):
 *     Ownership lines MUST NOT list @org/team handles.
 *     Intended team slugs must appear in CODEOWNERS comments / docs.
 *   GITHUB_OWNER_TYPE=Organization (optional, from workflow context):
 *     Fail closed unless PROCTIRA_CODEOWNERS_TEAMS_READY=1 — org repos must
 *     not sit indefinitely on personal-account interim ownership.
 *
 * Usage:
 *   node tools/scripts/check-codeowners.mjs
 *   node tools/scripts/check-codeowners.mjs --root=/path/to/repo
 *   node tools/scripts/check-codeowners.mjs --json
 *
 * Exit 0 on pass (including honest personal-account residual mode);
 * exit 1 on contract violation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CODEOWNERS_REL = '.github/CODEOWNERS';
export const AUDIT_REL = 'docs/audits/SEC_W1_SEC_13_CODEOWNERS.md';
export const COMPLETE_AUDIT_REL = 'docs/audits/SEC_W1_SEC_13_COMPLETE.md';

/** Canonical domains for W1-SEC-13 specialist routing. */
export const REQUIRED_DOMAINS = Object.freeze([
  'security',
  'data',
  'ops',
  'web',
  'governance',
]);

/**
 * Path substrings that must appear as ownership rules under specialist
 * domains (security / privacy / RLS+migrations / finance / infra).
 */
export const REQUIRED_SPECIALIST_PATHS = Object.freeze({
  security: [
    'packages/backend/auth/',
    'packages/backend/privacy/',
    'packages/shared/secrets/',
  ],
  privacy: ['packages/backend/privacy/'],
  rls_migrations: ['db/sql/', 'packages/shared/database/'],
  finance: [
    'packages/backend/fees/',
    'packages/backend/billing/',
    'packages/backend/scholarship/',
  ],
  infra: ['.github/', 'infrastructure/'],
});

/** Intended org team slugs (comments / cutover target — not inventable as live owners). */
export const INTENDED_TEAM_SLUGS = Object.freeze({
  security: '@proctira/security',
  data: '@proctira/data',
  ops: '@proctira/ops',
  web: '@proctira/web',
  governance: '@proctira/governance',
});

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * @param {string | undefined} value
 */
export function isTeamsReady(value = process.env.PROCTIRA_CODEOWNERS_TEAMS_READY) {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

/**
 * Personal-interim ownership (@user only) is allowed only when explicitly waived.
 * Silent green PASS without this waiver greenwashes W1-SEC-13 OPEN residual.
 * @param {string | undefined} value
 */
export function isPersonalInterimAllowed(
  value = process.env.PROCTIRA_CODEOWNERS_ALLOW_PERSONAL_INTERIM,
) {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

/**
 * @param {string | undefined} value
 */
export function isOrganizationOwner(value = process.env.GITHUB_OWNER_TYPE) {
  return String(value ?? '').trim().toLowerCase() === 'organization';
}

/**
 * @param {string} owner
 */
export function isTeamHandle(owner) {
  return /^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(owner);
}

/**
 * @param {string} owner
 */
export function isUserHandle(owner) {
  return /^@[A-Za-z0-9_-]+$/.test(owner) && !owner.includes('/');
}

/**
 * @param {string} text
 * @returns {{
 *   lines: Array<{
 *     lineNo: number,
 *     raw: string,
 *     kind: 'comment' | 'blank' | 'rule',
 *     pattern?: string,
 *     owners?: string[],
 *   }>,
 *   rules: Array<{ lineNo: number, pattern: string, owners: string[] }>,
 *   comments: string[],
 * }}
 */
export function parseCodeowners(text) {
  const lines = [];
  const rules = [];
  const comments = [];

  const rawLines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) {
      lines.push({ lineNo, raw, kind: 'blank' });
      continue;
    }
    if (trimmed.startsWith('#')) {
      lines.push({ lineNo, raw, kind: 'comment' });
      comments.push(trimmed);
      continue;
    }
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const pattern = tokens[0];
    const owners = tokens.slice(1);
    const rule = { lineNo, pattern, owners };
    lines.push({ lineNo, raw, kind: 'rule', pattern, owners });
    rules.push(rule);
  }

  return { lines, rules, comments };
}

/**
 * @param {string[]} comments
 * @param {string} domain
 */
export function commentMentionsDomain(comments, domain) {
  const re = new RegExp(`DOMAIN:\\s*${domain}\\b`, 'i');
  return comments.some((c) => re.test(c));
}

/**
 * @param {string[]} comments
 * @param {string} teamSlug
 */
export function commentMentionsTeam(comments, teamSlug) {
  return comments.some((c) => c.includes(teamSlug));
}

/**
 * @param {Array<{ pattern: string, owners: string[] }>} rules
 * @param {string} pathPrefix
 */
export function findRuleForPath(rules, pathPrefix) {
  return rules.find((r) => r.pattern === pathPrefix || r.pattern === pathPrefix.replace(/\/$/, ''));
}

/**
 * @param {{
 *   codeownersText: string,
 *   auditText?: string,
 *   completeAuditText?: string,
 *   teamsReady?: boolean,
 *   allowPersonalInterim?: boolean,
 *   ownerType?: string,
 * }} input
 */
export function evaluateCodeowners(input) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const residuals = [];
  /** @type {string[]} */
  const notes = [];

  const parsed = parseCodeowners(input.codeownersText ?? '');
  const teamsReady = input.teamsReady ?? isTeamsReady();
  const allowPersonalInterim =
    input.allowPersonalInterim ?? isPersonalInterimAllowed();
  const ownerType = String(input.ownerType ?? process.env.GITHUB_OWNER_TYPE ?? '').trim();
  const orgOwner = isOrganizationOwner(ownerType);

  if (!parsed.rules.length) {
    errors.push('CODEOWNERS has no ownership rules');
  }

  const fallback = parsed.rules.find((r) => r.pattern === '*');
  if (!fallback) {
    errors.push('missing fallback rule `* <owner>`');
  } else if (!fallback.owners.length) {
    errors.push('fallback rule `*` has no owners');
  }

  for (const domain of REQUIRED_DOMAINS) {
    if (!commentMentionsDomain(parsed.comments, domain)) {
      errors.push(`missing DOMAIN comment section for "${domain}"`);
    }
    const slug = INTENDED_TEAM_SLUGS[domain];
    if (!commentMentionsTeam(parsed.comments, slug)) {
      errors.push(`DOMAIN "${domain}" must document intended team slug ${slug} in comments`);
    }
  }

  for (const [bucket, paths] of Object.entries(REQUIRED_SPECIALIST_PATHS)) {
    for (const path of paths) {
      const rule = findRuleForPath(parsed.rules, path);
      if (!rule) {
        errors.push(`specialist path missing ownership rule: ${path} (${bucket})`);
        continue;
      }
      if (!rule.owners.length) {
        errors.push(`specialist path ${path} has no owners`);
      }
    }
  }

  const teamOwners = new Set();
  const userOwners = new Set();
  for (const rule of parsed.rules) {
    for (const owner of rule.owners) {
      if (isTeamHandle(owner)) teamOwners.add(owner);
      else if (isUserHandle(owner)) userOwners.add(owner);
      else errors.push(`line ${rule.lineNo}: unrecognized owner token "${owner}"`);
    }
  }

  if (orgOwner && !teamsReady) {
    errors.push(
      'GitHub owner type is Organization but PROCTIRA_CODEOWNERS_TEAMS_READY is not 1 — set the repo/org variable after creating real teams and updating CODEOWNERS (fail closed)',
    );
  }

  if (!teamsReady) {
    if (teamOwners.size > 0) {
      errors.push(
        `CODEOWNERS lists team handle(s) ${[...teamOwners].join(', ')} but PROCTIRA_CODEOWNERS_TEAMS_READY≠1 — remove fake/unverified teams or set the readiness variable after org teams exist`,
      );
    }
    if (userOwners.size === 0) {
      errors.push('pre-cutover mode requires at least one personal @user owner on rules');
    }
    if (!allowPersonalInterim) {
      errors.push(
        'W1-SEC-13 OPEN: personal-interim CODEOWNERS (no specialist @org/team owners) requires explicit PROCTIRA_CODEOWNERS_ALLOW_PERSONAL_INTERIM=1 waiver until org teams exist and PROCTIRA_CODEOWNERS_TEAMS_READY=1',
      );
    }
    residuals.push(
      'W1-SEC-13 OPEN residual: personal-account / pre-cutover mode — specialist headings are comments; live owners resolve to personal account(s). Create org teams, set TEAMS_READY=1, enable Require review from Code Owners on protected main, then remove ALLOW_PERSONAL_INTERIM.',
    );
    notes.push('mode=personal-interim');
    notes.push('finding=W1-SEC-13-OPEN');
  } else {
    notes.push('mode=teams-ready');
    const specialistPaths = [
      ...REQUIRED_SPECIALIST_PATHS.security,
      ...REQUIRED_SPECIALIST_PATHS.privacy,
      ...REQUIRED_SPECIALIST_PATHS.rls_migrations,
      ...REQUIRED_SPECIALIST_PATHS.finance,
      ...REQUIRED_SPECIALIST_PATHS.infra,
    ];
    const uniquePaths = [...new Set(specialistPaths)];
    for (const path of uniquePaths) {
      const rule = findRuleForPath(parsed.rules, path);
      if (!rule) continue;
      const hasTeam = rule.owners.some((o) => isTeamHandle(o));
      if (!hasTeam) {
        errors.push(
          `PROCTIRA_CODEOWNERS_TEAMS_READY=1 but ${path} has no @org/team owner (got: ${rule.owners.join(' ') || '(none)'})`,
        );
      }
    }
    // Require core specialist teams on ownership rules (exact intended slug or same team name).
    for (const domain of ['security', 'data', 'ops']) {
      const slug = INTENDED_TEAM_SLUGS[domain];
      const teamName = slug.split('/')[1];
      const present = [...teamOwners].some((t) => t === slug || t.endsWith(`/${teamName}`));
      if (!present) {
        errors.push(
          `PROCTIRA_CODEOWNERS_TEAMS_READY=1 but team for domain "${domain}" (${slug} or @*/${teamName}) does not appear on any ownership rule`,
        );
      }
    }
  }

  if (!input.auditText || !/W1-SEC-13/.test(input.auditText)) {
    errors.push(`missing or incomplete audit pack ${AUDIT_REL}`);
  }
  if (!input.completeAuditText || !/W1-SEC-13/.test(input.completeAuditText)) {
    errors.push(`missing or incomplete complete-audit pack ${COMPLETE_AUDIT_REL}`);
  } else {
    if (!/PROCTIRA_CODEOWNERS_TEAMS_READY/.test(input.completeAuditText)) {
      errors.push(`${COMPLETE_AUDIT_REL} must document PROCTIRA_CODEOWNERS_TEAMS_READY`);
    }
    if (!/Require review from Code Owners|require.*code owners/i.test(input.completeAuditText)) {
      errors.push(`${COMPLETE_AUDIT_REL} must document branch-protection Code Owner review residual/requirement`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    residuals,
    notes,
    teamsReady,
    ownerType: ownerType || '(unset)',
    teamOwners: [...teamOwners].sort(),
    userOwners: [...userOwners].sort(),
    ruleCount: parsed.rules.length,
  };
}

/**
 * @param {string} root
 */
export function loadFromRoot(root) {
  const codeownersPath = join(root, CODEOWNERS_REL);
  const auditPath = join(root, AUDIT_REL);
  const completePath = join(root, COMPLETE_AUDIT_REL);
  return {
    codeownersPath,
    auditPath,
    completePath,
    codeownersText: existsSync(codeownersPath) ? readFileSync(codeownersPath, 'utf8') : '',
    auditText: existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '',
    completeAuditText: existsSync(completePath) ? readFileSync(completePath, 'utf8') : '',
  };
}

function parseArgs(argv) {
  let root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
  }
  return { root, json };
}

function main() {
  const { root, json } = parseArgs(process.argv.slice(2));
  const loaded = loadFromRoot(root);
  if (!existsSync(loaded.codeownersPath)) {
    console.error(`::error::check-codeowners: missing ${CODEOWNERS_REL}`);
    process.exit(1);
  }

  const report = evaluateCodeowners({
    codeownersText: loaded.codeownersText,
    auditText: loaded.auditText,
    completeAuditText: loaded.completeAuditText,
    teamsReady: isTeamsReady(),
    allowPersonalInterim: isPersonalInterimAllowed(),
    ownerType: process.env.GITHUB_OWNER_TYPE,
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`W1-SEC-13 CODEOWNERS gate — ${report.notes.join(',') || 'n/a'}`);
    console.log(`  ownerType=${report.ownerType} teamsReady=${report.teamsReady}`);
    console.log(`  rules=${report.ruleCount} users=${report.userOwners.join(',') || '-'} teams=${report.teamOwners.join(',') || '-'}`);
    for (const note of report.residuals) {
      console.log(`  residual: ${note}`);
    }
    if (!report.ok) {
      for (const err of report.errors) {
        console.error(`::error::check-codeowners: ${err}`);
      }
    } else {
      console.log('check-codeowners: PASS');
    }
  }

  process.exit(report.ok ? 0 : 1);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  main();
}
