/**
 * Regenerates body-hints.json from the backend validation schemas.
 *
 *   pnpm --filter @proctira/aitest exec tsx src/tracks/t02-cross-tenant-idor/gen-body-hints.ts
 *
 * Scans route registrations in packages/backend/<pkg>/src and
 * apps/api-gateway/src, finds `validate(<Schema>, request.body|query)` in each
 * handler, imports the module that exports the schema (TypeBox objects are
 * plain JSON Schema), and records id fields plus a minimal sample body/query.
 * Re-run after route or schema changes; the output is committed.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRootFromHere } from '../../foundation/index.js';

import {
  BODY_HINTS_FILE,
  scanRegistrations,
  type BodyHintsFile,
  type RouteHint,
} from './body-hints.js';
import { sampleSchema, type JsonSchema } from './schema-sample.js';
import { textSchemaFallback } from './schema-text.js';

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries.sort()) {
    if (e === 'node_modules' || e === 'dist' || e === '__tests__') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (e.endsWith('.ts') && !/\.(test|spec|d)\.ts$/.test(e)) out.push(full);
  }
}

const EXPORT_RE = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=/g;

function isSchema(v: unknown): v is JsonSchema {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['type'] === 'string' || Array.isArray(o['anyOf']) || Array.isArray(o['oneOf']);
}

async function main(): Promise<void> {
  const repoRoot = repoRootFromHere();
  const sources: Array<{ module: string; file: string }> = [];
  const gw: string[] = [];
  walk(join(repoRoot, 'apps/api-gateway/src'), gw);
  for (const f of gw) sources.push({ module: 'api-gateway', file: f });
  const backend = join(repoRoot, 'packages/backend');
  for (const pkg of readdirSync(backend).sort()) {
    const files: string[] = [];
    walk(join(backend, pkg, 'src'), files);
    for (const f of files) sources.push({ module: pkg, file: f });
  }

  const exportsByName = new Map<string, Array<{ module: string; file: string }>>();
  const texts = new Map<string, string>();
  for (const s of sources) {
    const text = readFileSync(s.file, 'utf8');
    texts.set(s.file, text);
    for (const m of text.matchAll(EXPORT_RE)) {
      const name = m[1] ?? '';
      const list = exportsByName.get(name) ?? [];
      list.push(s);
      exportsByName.set(name, list);
    }
  }

  const moduleCache = new Map<string, Record<string, unknown> | null>();
  const importFile = async (file: string): Promise<Record<string, unknown> | null> => {
    if (moduleCache.has(file)) return moduleCache.get(file) ?? null;
    let mod: Record<string, unknown> | null = null;
    try {
      mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch {
      mod = null;
    }
    moduleCache.set(file, mod);
    return mod;
  };
  const loadSchema = async (
    name: string,
    module: string,
    file: string,
  ): Promise<JsonSchema | undefined> => {
    const all = exportsByName.get(name) ?? [];
    const ordered = [
      ...all.filter((x) => x.file === file),
      ...all.filter((x) => x.file !== file && x.module === module),
      ...all.filter((x) => x.module !== module),
    ];
    for (const x of ordered) {
      const mod = await importFile(x.file);
      const v = mod?.[name];
      if (isSchema(v)) return v;
    }
    // Module-local schema: approximate it from the source text.
    return textSchemaFallback(texts.get(file) ?? '', name);
  };

  const hints: RouteHint[] = [];
  const unresolved: BodyHintsFile['unresolvedSchemas'] = [];
  for (const s of sources) {
    const text = texts.get(s.file) ?? '';
    if (!/validate\(/.test(text)) continue;
    for (const reg of scanRegistrations(text)) {
      if (!reg.bodySchema && !reg.querySchema) continue;
      const rel = relative(repoRoot, s.file);
      const hint: RouteHint = {
        module: s.module,
        file: rel,
        method: reg.method,
        pattern: reg.pattern,
        bodyIdFields: [],
        queryIdFields: [],
      };
      if (reg.bodySchema) {
        const schema = await loadSchema(reg.bodySchema, s.module, s.file);
        if (schema) {
          const sample = sampleSchema(schema);
          hint.bodySchema = reg.bodySchema;
          hint.bodyTemplate = sample.value;
          hint.bodyIdFields = sample.idFields;
        } else {
          unresolved.push({
            module: s.module,
            file: rel,
            method: reg.method,
            pattern: reg.pattern,
            schema: reg.bodySchema,
          });
        }
      }
      if (reg.querySchema) {
        const schema = await loadSchema(reg.querySchema, s.module, s.file);
        if (schema) {
          const sample = sampleSchema(schema);
          hint.querySchema = reg.querySchema;
          if (sample.value && typeof sample.value === 'object') {
            hint.queryTemplate = sample.value as Record<string, unknown>;
          }
          // Query values are strings: nested paths cannot be query keys.
          hint.queryIdFields = sample.idFields.filter((f) => !f.path.includes('.'));
        } else {
          unresolved.push({
            module: s.module,
            file: rel,
            method: reg.method,
            pattern: reg.pattern,
            schema: reg.querySchema,
          });
        }
      }
      if (hint.bodySchema || hint.querySchema) hints.push(hint);
    }
  }
  const doc: BodyHintsFile = {
    $comment:
      'Generated by gen-body-hints.ts from validate(<Schema>, request.body|query) in backend route handlers. Do not edit by hand; re-run the generator.',
    generatedFrom: 'packages/backend/*/src, apps/api-gateway/src',
    hints,
    unresolvedSchemas: unresolved,
  };
  writeFileSync(BODY_HINTS_FILE, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(
    `body-hints.json: ${hints.length} hints (${hints.filter((h) => h.bodyIdFields.length).length} with body id fields, ${hints.filter((h) => h.queryIdFields.length).length} with query id fields), ${unresolved.length} unresolved schemas\n`,
  );
}

await main();
