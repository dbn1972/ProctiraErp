import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd());
const ignored = /(?:^|\/)(?:node_modules|\.next|dist|build|coverage|generated)(?:\/|$)/;
const formatExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.css',
  '.scss',
  '.prisma',
]);

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function run(label, command, args, cwd = root, timeout = 120_000) {
  process.stdout.write(`\n[Kiro quality] ${label}\n`);
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, timeout });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return result.status === 0 && !result.error;
}

function changedFiles() {
  const tracked = capture('git', ['diff', '--name-only', '--diff-filter=ACMRD', 'HEAD']).split(
    '\n',
  );
  const untracked = capture('git', ['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...tracked, ...untracked])]
    .map((path) => path.trim().replaceAll('\\', '/'))
    .filter((path) => path && !ignored.test(path));
}

function nearestWorkspace(file) {
  let current = dirname(join(root, file));
  while (current.startsWith(root) && current !== root) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) return current;
    current = dirname(current);
  }
  return undefined;
}

let files;
try {
  files = changedFiles();
} catch (error) {
  process.stderr.write(`[Kiro quality] Could not discover changed files: ${error.message}\n`);
  process.exit(1);
}

if (files.length === 0) {
  process.stdout.write('[Kiro quality] No changed files detected.\n');
  process.exit(0);
}

let failed = false;
function record(result) {
  if (!result) failed = true;
}

const allFormattable = files.filter(
  (file) => existsSync(join(root, file)) && formatExtensions.has(extname(file).toLowerCase()),
);
const formattable = allFormattable.slice(0, 100);
if (allFormattable.length > formattable.length) {
  process.stderr.write(
    `[Kiro quality] ${allFormattable.length - formattable.length} additional files were omitted from the local formatting gate; run full CI before merge.\n`,
  );
}
if (formattable.length > 0) {
  record(
    run(
      'Prettier on changed files',
      'pnpm',
      ['exec', 'prettier', '--check', '--', ...formattable],
      root,
      60_000,
    ),
  );
}

const workspaces = new Map();
for (const file of files) {
  const workspace = nearestWorkspace(file);
  if (!workspace) continue;
  if (!workspaces.has(workspace)) workspaces.set(workspace, []);
  workspaces.get(workspace).push(file);
}

const selected = [...workspaces.entries()].slice(0, 8);
if (workspaces.size > selected.length) {
  process.stderr.write(
    `[Kiro quality] ${workspaces.size - selected.length} additional changed workspaces were skipped; run full affected CI before merge.\n`,
  );
}

for (const [workspace, workspaceFiles] of selected) {
  const manifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));
  const scripts = manifest.scripts ?? {};
  const label = manifest.name ?? relative(root, workspace);
  for (const script of ['lint', 'typecheck']) {
    if (scripts[script]) record(run(`${label} ${script}`, 'pnpm', ['run', script], workspace));
  }
  const testsChanged = workspaceFiles.some((file) =>
    /(?:^|\/).+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file),
  );
  if (testsChanged && scripts.test) {
    record(run(`${label} tests (test files changed)`, 'pnpm', ['run', 'test'], workspace, 180_000));
  }
}

const hasReactChanges = files.some((file) =>
  /^(?:apps\/(?:web|admin-console|developer-portal|install-wizard|public-website|registration-portal)|packages\/ui)\/.*\.tsx?$/.test(
    file,
  ),
);
const hasThemeChanges = files.some((file) =>
  /(?:theme|tailwind|tokens?|styles?).*\.(?:ts|tsx|js|css|json)$/i.test(file),
);
const hasI18nChanges = files.some((file) =>
  /(?:locales?|messages|i18n|language).*\.(?:json|ts|tsx|dart)$/i.test(file),
);
const hasPrismaChanges = files.some((file) =>
  /(?:^|\/)prisma\/(?:schema\.prisma|migrations\/)/.test(file),
);
const hasTenantCriticalChanges = files.some(
  (file) =>
    /(?:tenant|auth|rbac|rls|cache|events?|queue|report)/i.test(file) &&
    /\.(?:ts|prisma|sql)$/.test(file),
);

if (hasReactChanges) {
  record(run('Accessibility icon-label gate', 'pnpm', ['run', 'lint:a11y'], root, 60_000));
}
if (hasThemeChanges) {
  record(run('Theme contrast gate', 'pnpm', ['run', 'check:contrast'], root, 60_000));
}
if (hasI18nChanges) {
  record(run('Localization catalog gate', 'pnpm', ['run', 'check:i18n'], root, 60_000));
}
if (hasPrismaChanges) {
  record(
    run(
      'Prisma schema validation',
      'pnpm',
      ['exec', 'prisma', 'validate', '--schema', 'packages/shared/database/prisma/schema.prisma'],
      root,
      60_000,
    ),
  );
}
if (hasTenantCriticalChanges) {
  record(
    run('Tenant isolation unit gate', 'pnpm', ['run', 'test:tenant-isolation:unit'], root, 180_000),
  );
}

if (failed) {
  process.stderr.write(
    '\n[Kiro quality] One or more targeted checks failed. Fix them before declaring the task complete.\n',
  );
  process.exit(1);
}

process.stdout.write(
  '\n[Kiro quality] Targeted changed-workspace checks passed. Run full CI/release gates when required.\n',
);
