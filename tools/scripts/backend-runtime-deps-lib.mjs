/**
 * PRC-L178 — shared dependency-declaration helpers for backend runtime bundles.
 *
 * `bundle-backend-runtime.mjs` externalizes third-party imports. Each external
 * bare import must be declared (dependencies / peerDependencies /
 * optionalDependencies) by the workspace package that owns the importing
 * source file; otherwise the production image only works through a phantom
 * dependency. `backend-runtime-resolve-hook.mjs` uses the same declarations as
 * its explicit allowlist, so the fallback never resolves an undeclared package.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join } from 'node:path';

export const RUNTIME_DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`.
 * @param {string} specifier
 * @returns {string | null} null for relative/absolute/URL/builtin specifiers
 */
export function packageNameOf(specifier) {
  if (!specifier || typeof specifier !== 'string') return null;
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    /^[a-z]+:/i.test(specifier) ||
    isBuiltin(specifier)
  ) {
    return null;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 && parts[1] ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] || null;
}

/**
 * @param {object} pkg parsed package.json
 * @returns {Set<string>}
 */
export function declaredRuntimeDeps(pkg) {
  const out = new Set();
  for (const field of RUNTIME_DEP_FIELDS) {
    const deps = pkg && typeof pkg === 'object' ? pkg[field] : undefined;
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) out.add(name);
    }
  }
  return out;
}

/**
 * Nearest package.json in the directory containing `filePath` or above.
 * @param {string} filePath absolute path of a source/bundle file
 * @returns {string | null}
 */
export function findOwningPackageJson(filePath) {
  let dir = dirname(filePath);
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Validate collected external imports against the importer's own package.json.
 * @param {Array<{ specifier: string, importer: string }>} externals
 * @param {(importer: string) => { pkgJsonPath: string, deps: Set<string> } | null} ownerOf
 * @returns {string[]} human-readable violations (empty = pass)
 */
export function findUndeclaredExternals(externals, ownerOf) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const violations = [];
  for (const { specifier, importer } of externals) {
    const name = packageNameOf(specifier);
    if (!name) continue;
    const owner = ownerOf(importer);
    if (!owner) {
      const key = `${name}|<none>`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push(`${name}: importer ${importer} has no owning package.json`);
      }
      continue;
    }
    if (owner.deps.has(name)) continue;
    const key = `${name}|${owner.pkgJsonPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push(
      `${name}: imported by ${importer} but not declared in ${owner.pkgJsonPath} (${RUNTIME_DEP_FIELDS.join('/')})`,
    );
  }
  return violations;
}

/**
 * Cached owner lookup backed by the filesystem.
 * @returns {(importer: string) => { pkgJsonPath: string, deps: Set<string> } | null}
 */
export function createFsOwnerLookup() {
  /** @type {Map<string, { pkgJsonPath: string, deps: Set<string> } | null>} */
  const cache = new Map();
  return (importer) => {
    const pkgJsonPath = findOwningPackageJson(importer);
    if (!pkgJsonPath) return null;
    if (!cache.has(pkgJsonPath)) {
      cache.set(pkgJsonPath, {
        pkgJsonPath,
        deps: declaredRuntimeDeps(JSON.parse(readFileSync(pkgJsonPath, 'utf8'))),
      });
    }
    return cache.get(pkgJsonPath) ?? null;
  };
}
