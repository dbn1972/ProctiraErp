/**
 * PRC-M627: validate an install's `configuration` against the plugin manifest's
 * `configSchema` before it is stored.
 *
 * Plugin manifests declare a JSON-Schema-style object (`type: 'object'`,
 * `properties`, `required`, per-property `type` / `enum`, optional
 * `additionalProperties: false`). No JSON-Schema engine is a dependency of this
 * package, so this checks that subset and ignores other keywords. It fails
 * closed on the keywords it knows: a wrong type, a value outside `enum`, a
 * missing required key or an undeclared key under `additionalProperties: false`
 * is reported.
 */

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function checkValue(path: string, schema: unknown, value: unknown, errors: string[]): void {
  if (!isRecord(schema)) return;
  const { type } = schema;
  if (typeof type === 'string') {
    const check = TYPE_CHECKS[type];
    if (!check) {
      errors.push(`${path}: unsupported schema type '${type}'`);
      return;
    }
    if (!check(value)) {
      errors.push(`${path}: expected ${type}`);
      return;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => allowed === value)) {
    errors.push(`${path}: value is not one of the allowed values`);
  }
}

/**
 * Return the list of validation errors for `configuration` under `configSchema`
 * (empty when valid). A plugin without a `configSchema` accepts any configuration.
 */
export function validatePluginConfiguration(
  configSchema: Record<string, unknown> | null,
  configuration: Record<string, unknown> | null | undefined,
): string[] {
  if (!configSchema) return [];
  const errors: string[] = [];
  const config = configuration ?? {};

  if (configSchema.type !== undefined && configSchema.type !== 'object') {
    return [`configSchema type '${String(configSchema.type)}' is not supported for configuration`];
  }

  const properties = isRecord(configSchema.properties) ? configSchema.properties : {};
  const required = Array.isArray(configSchema.required)
    ? configSchema.required.filter((k): k is string => typeof k === 'string')
    : [];

  for (const key of required) {
    if (!hasOwn(config, key)) errors.push(`${key}: is required`);
  }
  for (const [key, value] of Object.entries(config)) {
    if (hasOwn(properties, key)) {
      checkValue(key, properties[key], value, errors);
    } else if (configSchema.additionalProperties === false) {
      errors.push(`${key}: is not a declared configuration property`);
    }
  }
  return errors;
}
