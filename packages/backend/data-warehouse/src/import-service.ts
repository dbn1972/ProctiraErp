/**
 * Data Import Service
 *
 * Handles data import from Excel (DES format), CSV, and database connections.
 * Validates IUS (indicator-unit-subgroup-area-timeperiod) combinations for
 * uniqueness and referential integrity.
 */
import { v4 as uuidv4 } from 'uuid';

import type { DataRecord, DataRecordInput, ImportResult, ImportRowError } from './schemas.js';
import type { WarehouseRepository } from './warehouse-repository.js';

/**
 * Splits delimited text into rows of fields (RFC 4180 style): supports quoted
 * fields containing delimiters/newlines, doubled-quote escapes, and CRLF/LF endings.
 * Blank lines are skipped.
 */
export function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = content.replace(/^\uFEFF/, '');

  const endRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else if (ch === '\n' || ch === '\r') {
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Strict decimal / scientific number (rejects "12abc", "1,000", "0x10"). */
const STRICT_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Values that start like a number but are not one are treated as data errors. */
const NUMERIC_LIKE = /^[+-]?\.?\d/;

export interface ParsedImport {
  records: DataRecordInput[];
  /** Row-level parse errors keyed by 0-based record index. */
  rowErrors: Map<number, ImportRowError>;
}

interface ColumnAliases {
  indicatorGid: string[];
  unitGid: string[];
  subgroupGid: string[];
  areaId: string[];
  timePeriod: string[];
  footnote?: string[];
}

function parseTabular(rows: string[][], aliases: ColumnAliases): ParsedImport {
  const records: DataRecordInput[] = [];
  const rowErrors = new Map<number, ImportRowError>();
  if (rows.length < 2) return { records, rowErrors };

  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idx = {
    indicatorGid: col(aliases.indicatorGid),
    unitGid: col(aliases.unitGid),
    subgroupGid: col(aliases.subgroupGid),
    areaId: col(aliases.areaId),
    timePeriod: col(aliases.timePeriod),
    dataValue: col(['datavalue', 'data_value']),
    source: col(['source']),
    footnote: aliases.footnote ? col(aliases.footnote) : -1,
  };

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r]!.map((v) => v.trim());
    const get = (i: number) => (i === -1 ? '' : (values[i] ?? ''));
    const record: DataRecordInput = {
      indicatorGid: get(idx.indicatorGid),
      unitGid: get(idx.unitGid),
      subgroupGid: get(idx.subgroupGid),
      areaId: get(idx.areaId),
      timePeriod: get(idx.timePeriod),
    };

    const rawValue = get(idx.dataValue);
    if (rawValue) {
      if (STRICT_NUMBER.test(rawValue)) {
        record.dataValue = Number(rawValue);
      } else if (NUMERIC_LIKE.test(rawValue)) {
        rowErrors.set(records.length, {
          row: records.length + 1,
          field: 'dataValue',
          message: `Invalid numeric data value: ${rawValue}`,
        });
      } else {
        record.textualDataValue = rawValue;
      }
    }

    const source = get(idx.source);
    if (source) record.source = source;
    const footnote = get(idx.footnote);
    if (footnote) record.footnote = footnote;

    records.push(record);
  }
  return { records, rowErrors };
}

/**
 * Parses CSV content with row-level errors.
 * Expected columns: indicatorGid, unitGid, subgroupGid, areaId, timePeriod, dataValue, source, footnote
 */
export function parseCsvImport(content: string): ParsedImport {
  return parseTabular(parseDelimited(content, ','), {
    indicatorGid: ['indicatorgid', 'indicator_gid'],
    unitGid: ['unitgid', 'unit_gid'],
    subgroupGid: ['subgroupgid', 'subgroup_gid'],
    areaId: ['areaid', 'area_id'],
    timePeriod: ['timeperiod', 'time_period'],
    footnote: ['footnote'],
  });
}

/** Parses CSV content into data record inputs (rows with invalid numbers are kept; see parseCsvImport). */
export function parseCsvContent(content: string): DataRecordInput[] {
  return parseCsvImport(content).records;
}

/**
 * Parses Excel DES format content (base64-encoded, tab-separated text representation)
 * with row-level errors. Columns: Indicator, Unit, Subgroup, Area, TimePeriod, DataValue, Source.
 * In production, this would use a proper Excel parsing library (e.g., xlsx/exceljs).
 */
export function parseExcelDesImport(base64Content: string): ParsedImport {
  const content = Buffer.from(base64Content, 'base64').toString('utf-8');
  return parseTabular(parseDelimited(content, '\t'), {
    indicatorGid: ['indicator', 'indicatorgid'],
    unitGid: ['unit', 'unitgid'],
    subgroupGid: ['subgroup', 'subgroupgid'],
    areaId: ['area', 'areaid'],
    timePeriod: ['timeperiod', 'time_period'],
  });
}

export function parseExcelDesContent(base64Content: string): DataRecordInput[] {
  return parseExcelDesImport(base64Content).records;
}

export interface ImportContext {
  warehouseId: string;
  tenantId: string;
  repository: WarehouseRepository;
  /** Parse-time row errors keyed by 0-based record index; those rows are not imported. */
  rowErrors?: Map<number, ImportRowError>;
}

/**
 * Validates and imports data records into the warehouse.
 * Checks referential integrity (indicator, unit, subgroup, area, time period must exist)
 * and uniqueness (no duplicate IUS-area-timeperiod combinations).
 */
export async function importDataRecords(
  context: ImportContext,
  records: DataRecordInput[],
): Promise<ImportResult> {
  const { warehouseId, tenantId, repository, rowErrors: parseErrors } = context;
  const result: ImportResult = {
    totalRows: records.length,
    successCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    errors: [],
  };

  const validRecords: DataRecord[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const rowNum = i + 1;
    const rowErrors: ImportRowError[] = [];

    const parseError = parseErrors?.get(i);
    if (parseError) {
      result.errors.push({ ...parseError, row: rowNum });
      result.errorCount++;
      continue;
    }

    // Validate required fields
    if (!record.indicatorGid) {
      rowErrors.push({ row: rowNum, field: 'indicatorGid', message: 'Indicator GID is required' });
    }
    if (!record.unitGid) {
      rowErrors.push({ row: rowNum, field: 'unitGid', message: 'Unit GID is required' });
    }
    if (!record.subgroupGid) {
      rowErrors.push({ row: rowNum, field: 'subgroupGid', message: 'Subgroup GID is required' });
    }
    if (!record.areaId) {
      rowErrors.push({ row: rowNum, field: 'areaId', message: 'Area ID is required' });
    }
    if (!record.timePeriod) {
      rowErrors.push({ row: rowNum, field: 'timePeriod', message: 'Time period is required' });
    }

    if (rowErrors.length > 0) {
      result.errors.push(...rowErrors);
      result.errorCount++;
      continue;
    }

    // Validate referential integrity - resolve GIDs to internal IDs
    const indicator = await repository.findIndicatorByGid(
      record.indicatorGid,
      warehouseId,
      tenantId,
    );
    if (!indicator) {
      result.errors.push({
        row: rowNum,
        field: 'indicatorGid',
        message: `Indicator not found: ${record.indicatorGid}`,
      });
      result.errorCount++;
      continue;
    }

    const unit = await repository.findUnitByGid(record.unitGid, warehouseId, tenantId);
    if (!unit) {
      result.errors.push({
        row: rowNum,
        field: 'unitGid',
        message: `Unit not found: ${record.unitGid}`,
      });
      result.errorCount++;
      continue;
    }

    const subgroup = await repository.findSubgroupByGid(record.subgroupGid, warehouseId, tenantId);
    if (!subgroup) {
      result.errors.push({
        row: rowNum,
        field: 'subgroupGid',
        message: `Subgroup not found: ${record.subgroupGid}`,
      });
      result.errorCount++;
      continue;
    }

    const area = await repository.findAreaByExternalId(record.areaId, warehouseId, tenantId);
    if (!area) {
      result.errors.push({
        row: rowNum,
        field: 'areaId',
        message: `Area not found: ${record.areaId}`,
      });
      result.errorCount++;
      continue;
    }

    const timePeriod = await repository.findTimePeriodByLabel(
      record.timePeriod,
      warehouseId,
      tenantId,
    );
    if (!timePeriod) {
      result.errors.push({
        row: rowNum,
        field: 'timePeriod',
        message: `Time period not found: ${record.timePeriod}`,
      });
      result.errorCount++;
      continue;
    }

    // Validate uniqueness - check if IUS-area-timeperiod combination already exists
    const existing = await repository.findDataRecord(
      warehouseId,
      tenantId,
      indicator.id,
      unit.id,
      subgroup.id,
      area.id,
      timePeriod.id,
    );

    if (existing) {
      result.errors.push({
        row: rowNum,
        field: null,
        message: `Duplicate IUS-area-timeperiod combination: indicator=${record.indicatorGid}, unit=${record.unitGid}, subgroup=${record.subgroupGid}, area=${record.areaId}, timePeriod=${record.timePeriod}`,
      });
      result.duplicateCount++;
      result.errorCount++;
      continue;
    }

    // Also check within the current batch for duplicates
    const batchDuplicate = validRecords.find(
      (r) =>
        r.indicatorId === indicator.id &&
        r.unitId === unit.id &&
        r.subgroupId === subgroup.id &&
        r.areaId === area.id &&
        r.timePeriodId === timePeriod.id,
    );

    if (batchDuplicate) {
      result.errors.push({
        row: rowNum,
        field: null,
        message: `Duplicate IUS-area-timeperiod combination within import batch: indicator=${record.indicatorGid}, unit=${record.unitGid}, subgroup=${record.subgroupGid}, area=${record.areaId}, timePeriod=${record.timePeriod}`,
      });
      result.duplicateCount++;
      result.errorCount++;
      continue;
    }

    // Build valid data record
    const now = new Date();
    validRecords.push({
      id: uuidv4(),
      warehouseId,
      tenantId,
      indicatorId: indicator.id,
      unitId: unit.id,
      subgroupId: subgroup.id,
      areaId: area.id,
      timePeriodId: timePeriod.id,
      dataValue: record.dataValue ?? null,
      textualDataValue: record.textualDataValue ?? null,
      source: record.source ?? null,
      footnote: record.footnote ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Batch insert valid records
  if (validRecords.length > 0) {
    await repository.createDataRecordsBatch(validRecords);
    result.successCount = validRecords.length;
  }

  return result;
}
