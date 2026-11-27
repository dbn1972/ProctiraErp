/**
 * Text fallback for module-local TypeBox schemas (`const X = Type.Object({...})`
 * that is not exported, so the generator cannot import it): top-level keys,
 * `Type.Optional` for not-required, and a rough type per key.
 */
import type { JsonSchema } from './schema-sample.js';

/** Text of the balanced `(...)` starting at `open` (index of '('). */
export function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
}

/** Top-level `key: expr` entries of an object literal body. */
export function topLevelEntries(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if ('({['.includes(ch ?? '')) depth++;
    else if (')}]'.includes(ch ?? '')) depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  for (const p of parts) {
    const m =
      /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*([\s\S]+)$/.exec(
        p,
      );
    if (m) out.push([m[1] ?? '', (m[2] ?? '').trim()]);
  }
  return out;
}

function exprSchema(expr: string): JsonSchema {
  const e = expr.replace(/^Type\.Optional\(/, '');
  const lit = /^Type\.Literal\(\s*(['"])([^'"]*)\1/.exec(e);
  if (lit) return { const: lit[2], type: 'string' };
  const unionLit = /^Type\.Union\(\s*\[\s*Type\.Literal\(\s*(['"])([^'"]*)\1/.exec(e);
  if (unionLit) return { const: unionLit[2], type: 'string' };
  if (/^Type\.(Number|Integer)/.test(e)) {
    const min = /minimum:\s*(-?[\d.]+)/.exec(e);
    return { type: 'number', ...(min ? { minimum: Number(min[1]) } : { minimum: 1 }) };
  }
  if (/^Type\.Boolean/.test(e)) return { type: 'boolean' };
  if (/^Type\.Array/.test(e)) {
    const uuid = /uuid|UUID/.test(e);
    const min = /minItems:\s*(\d+)/.exec(e);
    return {
      type: 'array',
      items: { type: 'string', ...(uuid ? { format: 'uuid' } : {}) },
      ...(min ? { minItems: Number(min[1]) } : {}),
    };
  }
  if (/^Type\.Object/.test(e)) return { type: 'object', properties: {} };
  const s: JsonSchema = { type: 'string' };
  if (/uuid|UUID/.test(e)) s.format = 'uuid';
  else if (/format:\s*['"]date-time['"]/.test(e)) s.format = 'date-time';
  else if (/format:\s*['"]date['"]/.test(e)) s.format = 'date';
  return s;
}

/**
 * Approximate schema for a module-local `const X = Type.Object({...})` that
 * cannot be imported: top-level keys, Optional for not-required, a rough type.
 */
export function textSchemaFallback(source: string, name: string): JsonSchema | undefined {
  const re = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=\\n]+)?=\\s*Type\\.Object\\(`);
  const m = re.exec(source);
  if (!m) return undefined;
  const open = (m.index ?? 0) + m[0].length - 1;
  const arg = balanced(source, open).trim();
  if (!arg.startsWith('{')) return undefined;
  const body = arg.slice(1, arg.lastIndexOf('}'));
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, expr] of topLevelEntries(body)) {
    properties[key] = exprSchema(expr);
    if (!expr.startsWith('Type.Optional(')) required.push(key);
  }
  return { type: 'object', properties, required };
}
