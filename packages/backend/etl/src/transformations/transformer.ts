/**
 * Transformation Engine
 *
 * Applies field mapping and transformation rules to extracted data rows.
 * Supports: type_cast, lookup, concatenate, format, custom transformations.
 */
import type { FieldMapping, TransformationType } from '../schemas.js';
import type { DataRow } from '../connectors/types.js';

export interface TransformationResult {
  rows: DataRow[];
  transformedCount: number;
  errorCount: number;
  errors: TransformError[];
}

export interface TransformError {
  row: number;
  field: string;
  message: string;
}

/**
 * Apply field mappings and transformations to a set of data rows.
 */
export function transformRows(
  sourceRows: DataRow[],
  fieldMappings: FieldMapping[],
): TransformationResult {
  const transformedRows: DataRow[] = [];
  const errors: TransformError[] = [];
  let transformedCount = 0;

  for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex++) {
    const sourceRow = sourceRows[rowIndex]!;
    const destRow: DataRow = {};
    let rowHasError = false;

    for (const mapping of fieldMappings) {
      try {
        const value = applyMapping(sourceRow, mapping);
        destRow[mapping.destinationField] = value;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown transformation error';
        errors.push({
          row: rowIndex,
          field: mapping.sourceField,
          message,
        });
        rowHasError = true;
        // Still set the raw value on error so the row isn't incomplete
        destRow[mapping.destinationField] = sourceRow[mapping.sourceField] ?? null;
      }
    }

    transformedRows.push(destRow);
    if (!rowHasError) {
      transformedCount++;
    }
  }

  return {
    rows: transformedRows,
    transformedCount,
    errorCount: errors.length,
    errors,
  };
}

/**
 * Apply a single field mapping (with optional transformation) to a source row.
 */
function applyMapping(sourceRow: DataRow, mapping: FieldMapping): unknown {
  const rawValue = sourceRow[mapping.sourceField];

  if (!mapping.transformation) {
    return rawValue ?? null;
  }

  return applyTransformation(
    rawValue,
    sourceRow,
    mapping.transformation,
    mapping.transformConfig ?? {},
  );
}

/**
 * Apply a transformation rule to a value.
 */
function applyTransformation(
  value: unknown,
  sourceRow: DataRow,
  type: TransformationType,
  config: Record<string, unknown>,
): unknown {
  switch (type) {
    case 'type_cast':
      return applyTypeCast(value, config);
    case 'lookup':
      return applyLookup(value, config);
    case 'concatenate':
      return applyConcatenate(sourceRow, config);
    case 'format':
      return applyFormat(sourceRow, config);
    case 'custom':
      return applyCustom(value, sourceRow, config);
    default:
      return value;
  }
}

/**
 * Type cast transformation.
 * Converts a value to the specified target type.
 */
function applyTypeCast(value: unknown, config: Record<string, unknown>): unknown {
  const targetType = config['targetType'] as string;

  if (value === null || value === undefined) {
    return null;
  }

  switch (targetType) {
    case 'string':
      return String(value);
    case 'number': {
      const num = Number(value);
      if (isNaN(num)) {
        throw new Error(`Cannot cast "${String(value)}" to number`);
      }
      return num;
    }
    case 'integer': {
      const int = parseInt(String(value), 10);
      if (isNaN(int)) {
        throw new Error(`Cannot cast "${String(value)}" to integer`);
      }
      return int;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const str = String(value).toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(str)) return true;
      if (['false', '0', 'no', 'n'].includes(str)) return false;
      throw new Error(`Cannot cast "${String(value)}" to boolean`);
    }
    case 'date': {
      const format = config['format'] as string | undefined;
      void format; // Format would be used with a date parsing library
      const date = new Date(String(value));
      if (isNaN(date.getTime())) {
        throw new Error(`Cannot cast "${String(value)}" to date`);
      }
      return date.toISOString();
    }
    default:
      throw new Error(`Unsupported target type: ${targetType}`);
  }
}

/**
 * Lookup transformation.
 * Replaces a value using a lookup table (key-value mapping).
 */
function applyLookup(value: unknown, config: Record<string, unknown>): unknown {
  const lookupTable = config['lookupTable'] as Record<string, unknown> | undefined;
  const defaultValue = config['defaultValue'];

  if (!lookupTable) {
    throw new Error('Lookup table is required for lookup transformation');
  }

  const key = String(value ?? '');
  if (key in lookupTable) {
    return lookupTable[key];
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  return value;
}

/**
 * Concatenate transformation.
 * Joins multiple source fields with an optional separator.
 */
function applyConcatenate(sourceRow: DataRow, config: Record<string, unknown>): unknown {
  const fields = config['fields'] as string[] | undefined;
  const separator = (config['separator'] as string) ?? '';

  if (!fields || fields.length < 2) {
    throw new Error('At least 2 fields are required for concatenation');
  }

  const values = fields.map((field) => {
    const val = sourceRow[field];
    return val !== null && val !== undefined ? String(val) : '';
  });

  return values.join(separator);
}

/**
 * Format transformation.
 * Applies a template string with {field} placeholders replaced by source row values.
 */
function applyFormat(sourceRow: DataRow, config: Record<string, unknown>): unknown {
  const template = config['template'] as string | undefined;

  if (!template) {
    throw new Error('Template is required for format transformation');
  }

  return template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const val = sourceRow[field];
    return val !== null && val !== undefined ? String(val) : '';
  });
}

/**
 * Custom transformation.
 * Evaluates a simple expression against the value and source row.
 * Supports basic operations for safety (no eval).
 */
function applyCustom(value: unknown, sourceRow: DataRow, config: Record<string, unknown>): unknown {
  const expression = config['expression'] as string | undefined;

  if (!expression) {
    throw new Error('Expression is required for custom transformation');
  }

  // Simple expression support:
  // - "uppercase" -> converts to uppercase
  // - "lowercase" -> converts to lowercase
  // - "trim" -> trims whitespace
  // - "prefix:XXX" -> prepends XXX
  // - "suffix:XXX" -> appends XXX
  // - "replace:old:new" -> replaces old with new
  // - "default:XXX" -> returns XXX if value is null/undefined/empty
  void sourceRow;

  const strValue = value !== null && value !== undefined ? String(value) : '';

  if (expression === 'uppercase') {
    return strValue.toUpperCase();
  }
  if (expression === 'lowercase') {
    return strValue.toLowerCase();
  }
  if (expression === 'trim') {
    return strValue.trim();
  }
  if (expression.startsWith('prefix:')) {
    const prefix = expression.slice(7);
    return prefix + strValue;
  }
  if (expression.startsWith('suffix:')) {
    const suffix = expression.slice(7);
    return strValue + suffix;
  }
  if (expression.startsWith('replace:')) {
    const parts = expression.slice(8).split(':');
    if (parts.length >= 2) {
      return strValue.replace(parts[0]!, parts[1]!);
    }
  }
  if (expression.startsWith('default:')) {
    const defaultVal = expression.slice(8);
    return strValue === '' ? defaultVal : strValue;
  }

  throw new Error(`Unsupported custom expression: ${expression}`);
}
