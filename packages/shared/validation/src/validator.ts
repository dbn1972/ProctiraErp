import type { FieldError } from '@proctira/common';
import { type TSchema, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * Result of a validation operation.
 * Either contains the validated (and cleaned) data, or an array of field-level errors.
 */
export type ValidationResult<T extends TSchema> =
  | { success: true; data: Static<T> }
  | { success: false; errors: FieldError[] };

/**
 * Maps a Typebox validation error path to a dot-notation field path.
 */
function formatFieldPath(path: string): string {
  // Typebox paths look like "/field/nested/0/sub"
  // Convert to "field.nested.0.sub"
  return path.replace(/^\//, '').replace(/\//g, '.');
}

/**
 * Maps a Typebox error message to a rule name.
 * More specific patterns are checked first to avoid false matches.
 */
function extractRule(message: string): string {
  // Check specific constraint messages BEFORE generic type messages
  if (message.includes('Required property')) return 'required';
  if (message.includes('Expected string length greater or equal to')) return 'minLength';
  if (message.includes('Expected string length less or equal to')) return 'maxLength';
  if (message.includes('Expected number to be greater or equal to')) return 'minimum';
  if (message.includes('Expected number to be less or equal to')) return 'maximum';
  if (message.includes('Expected string to match')) return 'pattern';
  if (message.includes('Unknown format')) return 'format';

  // Generic type checks (must come after specific constraint checks)
  if (message.includes('Expected string')) return 'type';
  if (message.includes('Expected number')) return 'type';
  if (message.includes('Expected boolean')) return 'type';
  if (message.includes('Expected object')) return 'type';
  if (message.includes('Expected array')) return 'type';

  return 'invalid';
}

/**
 * Generates a human-readable error message from a Typebox validation error.
 */
function formatMessage(error: {
  path: string;
  message: string;
  schema: Record<string, unknown>;
}): string {
  const field = formatFieldPath(error.path) || 'value';
  const message = error.message;

  // Provide cleaner messages for common cases
  if (message.includes('Required property')) {
    return `${field} is required`;
  }
  if (message.includes('Expected string length greater or equal to')) {
    const min = error.schema['minLength'];
    return `${field} must be at least ${String(min)} characters`;
  }
  if (message.includes('Expected string length less or equal to')) {
    const max = error.schema['maxLength'];
    return `${field} must be at most ${String(max)} characters`;
  }
  if (message.includes('Expected number to be greater or equal to')) {
    const min = error.schema['minimum'];
    return `${field} must be at least ${String(min)}`;
  }
  if (message.includes('Expected number to be less or equal to')) {
    const max = error.schema['maximum'];
    return `${field} must be at most ${String(max)}`;
  }
  if (message.includes('Expected string to match')) {
    const desc = error.schema['description'];
    if (desc) return `${field} must be a valid ${String(desc)}`;
    return `${field} does not match the required pattern`;
  }
  if (message.includes('Unknown format')) {
    const desc = error.schema['description'];
    if (desc) return `${field} must be a valid ${String(desc)}`;
    return `${field} has an invalid format`;
  }
  if (message.includes('Expected string')) {
    return `${field} must be a string`;
  }
  if (message.includes('Expected number')) {
    return `${field} must be a number`;
  }
  if (message.includes('Expected boolean')) {
    return `${field} must be a boolean`;
  }
  if (message.includes('Expected object')) {
    return `${field} must be an object`;
  }
  if (message.includes('Expected array')) {
    return `${field} must be an array`;
  }

  return `${field} is invalid`;
}

/**
 * Fastify 5 hands `request.query` / `request.params` to handlers as objects
 * whose prototype is not `Object.prototype`; TypeBox's `Value.Clone` only
 * accepts "standard" objects and otherwise throws "Unable to clone value".
 * Re-home any record-like object (recursively) onto `Object.prototype`
 * before cloning, leaving arrays, dates, buffers and other exotic values alone.
 */
function normaliseForClone(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(normaliseForClone);
  if (data === null || typeof data !== 'object') return data;
  if (
    data instanceof Date ||
    data instanceof RegExp ||
    data instanceof Map ||
    data instanceof Set ||
    ArrayBuffer.isView(data) ||
    data instanceof ArrayBuffer
  ) {
    return data;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    out[key] = normaliseForClone(value);
  }
  return out;
}

/**
 * Validates data against a Typebox schema.
 *
 * Returns either the validated data (with defaults applied) or
 * a structured array of FieldError objects with field paths and human-readable messages.
 *
 * @param schema - A Typebox schema to validate against
 * @param data - The data to validate
 * @returns ValidationResult with either validated data or field-level errors
 */
export interface ValidateOptions {
  /**
   * Coerce string scalars ("42", "true") into the schema's declared primitive
   * before validating. Intended for query strings / path params, where every
   * value arrives as a string. Never use for JSON bodies — a client must not
   * be able to satisfy `Type.Number()` with `"42"` there.
   */
  convert?: boolean;
}

export function validate<T extends TSchema>(
  schema: T,
  data: unknown,
  options: ValidateOptions = {},
): ValidationResult<T> {
  // Apply defaults first, then validate
  const cloned = Value.Clone(normaliseForClone(data));
  const withDefaults = Value.Default(
    schema,
    options.convert ? Value.Convert(schema, cloned) : cloned,
  );
  const errors = [...Value.Errors(schema, withDefaults)];

  if (errors.length === 0) {
    return { success: true, data: withDefaults as Static<T> };
  }

  const fieldErrors: FieldError[] = errors.map((error) => ({
    field: formatFieldPath(error.path) || 'value',
    message: formatMessage(error),
    rule: extractRule(error.message),
  }));

  return { success: false, errors: fieldErrors };
}

/** `validate` with `convert: true` — for query strings and path params. */
export function validateQuery<T extends TSchema>(schema: T, data: unknown): ValidationResult<T> {
  return validate(schema, data, { convert: true });
}
