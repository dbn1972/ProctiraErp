import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = realpathSync(process.cwd());
const supportedExtensions = new Set([
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
  '.dart',
  '.prisma',
]);
const ignoredSegments = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  'generated',
]);
const pathFieldNames = new Set(['filepath', 'path', 'savedfile', 'uri', 'fileuri']);

function collectStrings(value, target = []) {
  if (typeof value === 'string') target.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, target));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => collectStrings(item, target));
  return target;
}

function collectNamedPaths(value, target = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNamedPaths(item, target));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[_-]/g, '');
      if (pathFieldNames.has(normalizedKey) && typeof item === 'string') target.push(item);
      collectNamedPaths(item, target);
    }
  }
  return target;
}

function isInsideRoot(path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function toSupportedFile(value) {
  let path = value;
  if (path.startsWith('file:')) {
    try {
      path = fileURLToPath(path);
    } catch {
      return undefined;
    }
  }

  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!existsSync(candidate)) return undefined;
  const actual = realpathSync(candidate);
  if (!isInsideRoot(actual) || !statSync(actual).isFile()) return undefined;
  const relativeParts = actual.slice(root.length + 1).split(sep);
  if (relativeParts.some((part) => ignoredSegments.has(part))) return undefined;
  return supportedExtensions.has(extname(actual).toLowerCase()) ? actual : undefined;
}

function uniqueCandidates(values) {
  return [...new Set(values.map(toSupportedFile).filter(Boolean))];
}

function findSavedFile(event) {
  const namedCandidates = uniqueCandidates(collectNamedPaths(event));
  if (namedCandidates.length === 1) return namedCandidates[0];
  if (namedCandidates.length > 1) {
    throw new Error('the event contained multiple supported files in path fields');
  }

  const fallbackCandidates = uniqueCandidates(collectStrings(event));
  if (fallbackCandidates.length === 1) return fallbackCandidates[0];
  if (fallbackCandidates.length > 1) {
    throw new Error('the event contained multiple possible saved files');
  }
  return undefined;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 25_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

let event;
try {
  event = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.stderr.write('Kiro saved-file hook skipped: event payload was not valid JSON.\n');
  process.exit(0);
}

let file;
try {
  file = findSavedFile(event);
} catch (error) {
  process.stderr.write(`Kiro saved-file hook skipped: ${error.message}.\n`);
  process.exit(0);
}
if (!file) {
  process.stderr.write(
    'Kiro saved-file hook skipped: no supported workspace file was found in the event.\n',
  );
  process.exit(0);
}

const extension = extname(file).toLowerCase();
let status;
if (extension === '.dart') {
  status = run('dart', ['format', '--output=none', '--set-exit-if-changed', file]);
} else if (extension === '.prisma') {
  status = run('pnpm', ['exec', 'prisma', 'validate', '--schema', file]);
} else {
  status = run('pnpm', ['exec', 'prettier', '--check', '--', file]);
}

if (status !== 0) {
  process.stderr.write(`Saved-file validation failed for ${file}.\n`);
}
process.exit(status);
