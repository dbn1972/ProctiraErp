/**
 * Minimal valid-looking samples from the TypeBox (JSON Schema) objects the
 * backend validates request bodies and queries with, so an IDOR case reaches
 * the id-handling code instead of stopping at a 400 for a missing field.
 *
 * Id slots become placeholders `{{id:<field name>}}`. The live suites replace
 * them with the attacker's own ids, or with the attacked id for the field
 * under test. Only required properties and id properties are emitted.
 */

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  const?: unknown;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  default?: unknown;
  [k: string]: unknown;
};

export interface IdField {
  /** Dotted path in the body (`items.0.studentId`) or the query key. */
  path: string;
  /** Last property name, used to pick the fixture table (`studentId` → students). */
  name: string;
  array: boolean;
  required: boolean;
}

export const ID_NAME_RE = /^(?:id|ids)$|[a-z0-9](?:Id|Ids|_id|_ids)$/;
const SAMPLE_UUID = '3f0e8c2a-1111-4222-8333-444455556666';

export function placeholder(name: string): string {
  return `{{id:${name}}}`;
}

export function isPlaceholder(v: unknown): v is string {
  return typeof v === 'string' && /^\{\{id:[^}]+\}\}$/.test(v);
}

export function placeholderName(v: string): string {
  return v.slice(5, -2);
}

/** First non-null branch of a union, or the schema itself. */
export function firstBranch(s: JsonSchema): JsonSchema {
  const branches = s.anyOf ?? s.oneOf;
  if (!branches || branches.length === 0) return s.allOf?.[0] ?? s;
  return branches.find((b) => b.type !== 'null') ?? branches[0] ?? s;
}

function typeOf(s: JsonSchema): string | undefined {
  if (Array.isArray(s.type)) return s.type.find((t) => t !== 'null');
  if (s.type) return s.type;
  if (s.properties) return 'object';
  if (s.items) return 'array';
  if (typeof s.const === 'string' || typeof s.enum?.[0] === 'string') return 'string';
  return undefined;
}

/** True when a string schema describes a UUID (format or a UUID-shaped pattern). */
export function isUuidSchema(s: JsonSchema): boolean {
  const b = firstBranch(s);
  if (b.format === 'uuid') return true;
  if (typeof b.pattern === 'string') {
    try {
      return new RegExp(b.pattern).test(SAMPLE_UUID) && !new RegExp(b.pattern).test('abc');
    } catch {
      return false;
    }
  }
  return false;
}

export function isIdProperty(name: string, s: JsonSchema): boolean {
  const b = firstBranch(s);
  const t = typeOf(b);
  if (t === 'array') {
    const item = b.items ? firstBranch(b.items) : {};
    return typeOf(item) === 'string' && (ID_NAME_RE.test(name) || isUuidSchema(item));
  }
  return t === 'string' && (ID_NAME_RE.test(name) || isUuidSchema(b));
}

const STRING_CANDIDATES = [
  '2026-01-15',
  '2026-01-15T09:00:00.000Z',
  '09:00',
  'ABC123',
  'aitest',
  'A',
  'a',
  '1',
  'INR',
  'IN',
  '+919876543210',
  '9876543210',
  '123456',
  'aitest-1',
  'AITEST_1',
];

function sampleString(s: JsonSchema): string {
  if (s.const !== undefined) return String(s.const);
  if (s.enum && s.enum.length > 0) return String(s.enum[0]);
  if (typeof s.default === 'string') return s.default;
  const min = s.minLength ?? 0;
  const max = s.maxLength ?? 200;
  const fit = (v: string) => v.length >= min && v.length <= max;
  switch (s.format) {
    case 'date':
      return '2026-01-15';
    case 'date-time':
      return '2026-01-15T09:00:00.000Z';
    case 'time':
      return '09:00:00';
    case 'email':
      return 'aitest@proctira-aitest.test';
    case 'uri':
    case 'url':
      return 'https://aitest.example.test/x';
    default:
      break;
  }
  if (typeof s.pattern === 'string') {
    let re: RegExp | undefined;
    try {
      re = new RegExp(s.pattern);
    } catch {
      re = undefined;
    }
    if (re) {
      const hit = STRING_CANDIDATES.find((c) => re.test(c) && fit(c));
      if (hit) return hit;
    }
  }
  const base = 'aitest sample';
  if (base.length > max) return base.slice(0, Math.max(max, 1));
  return base.length >= min ? base : base.padEnd(min, 'x');
}

function sampleNumber(s: JsonSchema, integer: boolean): number {
  if (typeof s.const === 'number') return s.const;
  if (typeof s.enum?.[0] === 'number') return s.enum[0];
  if (typeof s.default === 'number') return s.default;
  let v = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 1);
  if (s.maximum !== undefined && v > s.maximum) v = s.maximum;
  return integer ? Math.ceil(v) : v;
}

export interface SampleResult {
  value: unknown;
  idFields: IdField[];
}

/**
 * Sample for a schema. Objects keep required properties and id properties;
 * id slots are placeholders named after their property.
 */
export function sampleSchema(schema: JsonSchema, depth = 0, path = ''): SampleResult {
  const idFields: IdField[] = [];
  const s = firstBranch(schema);
  const t = typeOf(s);
  if (depth > 4) return { value: undefined, idFields };
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    const required = new Set(s.required ?? []);
    for (const [key, prop] of Object.entries(s.properties ?? {})) {
      const childPath = path ? `${path}.${key}` : key;
      const idProp = isIdProperty(key, prop);
      if (!required.has(key) && !idProp) continue;
      if (idProp) {
        const b = firstBranch(prop);
        const array = typeOf(b) === 'array';
        idFields.push({ path: childPath, name: key, array, required: required.has(key) });
        out[key] = array ? [placeholder(key)] : placeholder(key);
        continue;
      }
      const child = sampleSchema(prop, depth + 1, childPath);
      if (child.value !== undefined) out[key] = child.value;
      idFields.push(...child.idFields);
    }
    return { value: out, idFields };
  }
  if (t === 'array') {
    const n = s.minItems ?? 0;
    if (n === 0 || !s.items) return { value: [], idFields };
    const values: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const child = sampleSchema(s.items, depth + 1, `${path}.${i}`);
      values.push(child.value);
      if (i === 0) idFields.push(...child.idFields);
    }
    return { value: values, idFields };
  }
  if (t === 'string') return { value: sampleString(s), idFields };
  if (t === 'integer') return { value: sampleNumber(s, true), idFields };
  if (t === 'number') return { value: sampleNumber(s, false), idFields };
  if (t === 'boolean')
    return { value: typeof s.default === 'boolean' ? s.default : false, idFields };
  if (t === 'null') return { value: null, idFields };
  return { value: s.const ?? s.default, idFields };
}

/**
 * Deep copy of a template with placeholders resolved. `resolve(name, path)`
 * returns the id for a slot; `override` maps a dotted path to a value that
 * replaces the slot (the attacked field).
 */
export function fillTemplate(
  template: unknown,
  resolve: (name: string, path: string) => string,
  override: Record<string, string> = {},
  path = '',
): unknown {
  if (isPlaceholder(template)) {
    return override[path] ?? resolve(placeholderName(template), path);
  }
  if (Array.isArray(template)) {
    // An id array `[ph]` is addressed by the array's own path.
    if (template.length === 1 && isPlaceholder(template[0])) {
      return [override[path] ?? resolve(placeholderName(template[0]), path)];
    }
    return template.map((v, i) => fillTemplate(v, resolve, override, `${path}.${i}`));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = fillTemplate(v, resolve, override, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return template;
}
