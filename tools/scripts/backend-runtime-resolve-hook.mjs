/**
 * ESM resolve hook companion for `backend-runtime-resolve.mjs`.
 * See that file for motivation (pnpm + bundled workspace entrypoints).
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const requireFns = listPackageJsonFiles().map((pkgJson) => {
  try {
    // Touch package name so empty/invalid packages are skipped quietly.
    JSON.parse(readFileSync(pkgJson, 'utf8'));
    return createRequire(pkgJson);
  } catch {
    return null;
  }
}).filter(Boolean);

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
    for (const req of requireFns) {
      try {
        const resolved = req.resolve(specifier);
        return {
          shortCircuit: true,
          url: pathToFileURL(resolved).href,
        };
      } catch {
        // try next workspace package
      }
    }
    throw err;
  }
}
