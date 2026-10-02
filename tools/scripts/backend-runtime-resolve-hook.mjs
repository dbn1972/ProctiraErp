/**
 * ESM resolve hook companion for `backend-runtime-resolve.mjs`.
 * See that file for motivation (pnpm + bundled workspace entrypoints).
 *
 * PRC-L178: the fallback is limited to an explicit allowlist — a bare
 * specifier is only resolved from a workspace package whose package.json
 * declares it (dependencies / peerDependencies / optionalDependencies).
 * Undeclared (phantom) packages keep Node's original resolution error.
 * `bundle-backend-runtime.mjs` enforces the same declarations at build time.
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { declaredRuntimeDeps, packageNameOf } from './backend-runtime-deps-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');

const WORKSPACE_ROOTS = ['apps', 'packages/shared', 'packages/backend', 'packages/ui', 'tools'];

function listPackageJsonFiles() {
  const files = [join(repoRoot, 'package.json')];
  for (const root of WORKSPACE_ROOTS) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) continue;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const pkgJson = join(abs, ent.name, 'package.json');
      if (existsSync(pkgJson)) files.push(pkgJson);
      // One more level for packages/ui/* and similar nests already covered by roots.
      const nested = join(abs, ent.name);
      try {
        for (const child of readdirSync(nested, { withFileTypes: true })) {
          if (!child.isDirectory()) continue;
          const nestedPkg = join(nested, child.name, 'package.json');
          if (existsSync(nestedPkg)) files.push(nestedPkg);
        }
      } catch {
        // ignore
      }
    }
  }
  return files;
}

/**
 * Allowlist: package name → require functions of workspace packages declaring it.
 * @param {string[]} pkgJsonFiles
 * @returns {Map<string, NodeRequire[]>}
 */
export function buildDeclaredResolvers(pkgJsonFiles) {
  /** @type {Map<string, NodeRequire[]>} */
  const map = new Map();
  for (const pkgJson of pkgJsonFiles) {
    let deps;
    try {
      deps = declaredRuntimeDeps(JSON.parse(readFileSync(pkgJson, 'utf8')));
    } catch {
      continue;
    }
    if (deps.size === 0) continue;
    const req = createRequire(pkgJson);
    for (const name of deps) {
      const list = map.get(name) ?? [];
      list.push(req);
      map.set(name, list);
    }
  }
  return map;
}
const declaredResolvers = buildDeclaredResolvers(listPackageJsonFiles());
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      specifier.startsWith('node:') ||
      specifier.startsWith('file:') ||
      specifier.startsWith('data:') ||
      specifier.startsWith('.') ||
      specifier.startsWith('/')
    ) {
      throw err;
    }
    const name = packageNameOf(specifier);
    const allowed = name ? declaredResolvers.get(name) : undefined;
    if (!allowed) throw err;
    for (const req of allowed) {
      try {
        const resolved = req.resolve(specifier);
        return {
          shortCircuit: true,
          url: pathToFileURL(resolved).href,
        };
      } catch {
        // try next declaring workspace package
      }
    }
    throw err;
  }
}
