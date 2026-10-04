import type { FormSchema } from './types';

/** Longest schema-supplied pattern accepted. */
export const MAX_PATTERN_LENGTH = 256;

/**
 * Heuristic for catastrophic backtracking: a group that contains a
 * quantifier and is itself quantified, e.g. `(a+)+`, `(.*)*`, `(\d{1,3})+`.
 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})\)(?:[+*]|\{\d+,\d*\})/;

export type PatternCheck = { ok: true; regex: RegExp } | { ok: false; reason: string };

/**
 * Compile a schema-supplied regex pattern without throwing.
 * Rejects invalid syntax, over-long patterns, and nested quantifiers.
 */
export function compileSchemaPattern(pattern: unknown): PatternCheck {
  const source = String(pattern ?? '');
  if (source.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: `pattern longer than ${MAX_PATTERN_LENGTH} characters` };
  }
  if (NESTED_QUANTIFIER.test(source)) {
    return { ok: false, reason: 'pattern has nested quantifiers (catastrophic backtracking)' };
  }
  try {
    return { ok: true, regex: new RegExp(source) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'invalid pattern' };
  }
}

export interface SchemaPatternIssue {
  field: string;
  pattern: string;
  reason: string;
}

/**
 * Validate every `pattern` rule in a schema. Call this wherever a schema is
 * saved (server-side or admin UI) and reject the save when issues are returned.
 */
export function validateSchemaPatterns(schema: FormSchema): SchemaPatternIssue[] {
  const issues: SchemaPatternIssue[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      for (const rule of field.validation ?? []) {
        if (rule.type !== 'pattern') continue;
        const result = compileSchemaPattern(rule.value);
        if (!result.ok) {
          issues.push({ field: field.name, pattern: String(rule.value), reason: result.reason });
        }
      }
    }
  }
  return issues;
}
