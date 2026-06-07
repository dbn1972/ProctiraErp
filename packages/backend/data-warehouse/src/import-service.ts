/**
 * Data Import Service
 *
 * Handles data import from Excel (DES format), CSV, and database connections.
 * Validates IUS (indicator-unit-subgroup-area-timeperiod) combinations for
 * uniqueness and referential integrity.
 */
import { v4 as uuidv4 } from 'uuid';

import type {
  DataRecord,
  DataRecordInput,
  ImportResult,
  ImportRowError,
} from './schemas.js';
import type { WarehouseRepository } from './warehouse-repository.js';

/**
 * Parses CSV content into data record inputs.
 * Expected columns: indicatorGid, unitGid, subgroupGid, areaId, timePeriod, dataValue, source, footnote
 */
export function parseCsvContent(content: string): DataRecordInput[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const records: DataRecordInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = line.split(',').map((v) => v.trim());
    const record: DataRecordInput = {
      indicatorGid: values[headers.indexOf('indicatorgid')] || values[headers.indexOf('indicator_gid')] || '',
      unitGid: values[headers.indexOf('unitgid')] || values[headers.indexOf('unit_gid')] || '',
      subgroupGid: values[headers.indexOf('subgroupgid')] || values[headers.indexOf('subgroup_gid')] || '',
      areaId: values[headers.indexOf('areaid')] || values[headers.indexOf('area_id')] || '',
      timePeriod: values[headers.indexOf('timeperiod')] || values[headers.indexOf('time_period')] || '',
    };

    const dataValueIdx = headers.indexOf('datavalue') !== -1 ? headers.indexOf('datavalue') : headers.indexOf('data_value');
    if (dataValueIdx !== -1 && values[dataValueIdx]) {
      const parsed = parseFloat(values[dataValueIdx]);
      if (!isNaN(parsed)) {
        record.dataValue = parsed;
      } else {
        record.textualDataValue = values[dataValueIdx];
      }
    }

    const sourceIdx = headers.indexOf('source');
    if (sourceIdx !== -1 && values[sourceIdx]) {
      record.source = values[sourceIdx];
    }

    const footnoteIdx = headers.indexOf('footnote');
    if (footnoteIdx !== -1 && values[footnoteIdx]) {
      record.footnote = values[footnoteIdx];
    }

    records.push(record);
  }

  return records;
}

/**
 * Parses Excel DES format content (base64-encoded) into data record inputs.
 * DES format is a simplified representation where the first sheet contains
 * columns: Indicator, Unit, Subgroup, Area, TimePeriod, DataValue, Source.
 *
 * For this implementation, we parse the base64 content as CSV-like tab-separated data.
 * In production, this would use a proper Excel parsing library (e.g., xlsx/exceljs).
 */
export function parseExcelDesContent(base64Content: string): DataRecordInput[] {
  // Decode base64 to string (assumes UTF-8 text representation for testing)
  const content = Buffer.from(base64Content, 'base64').toString('utf-8');
  // DES format uses tab-separated values
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split('\t').map((h) => h.trim().toLowerCase());
  const records: DataRecordInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = line.split('\t').map((v) => v.trim());
    const record: DataRecordInput = {
      indicatorGid: values[headers.indexOf('indicator')] || values[headers.indexOf('indicatorgid')] || '',
      unitGid: values[headers.indexOf('unit')] || values[headers.indexOf('unitgid')] || '',
      subgroupGid: values[headers.indexOf('subgroup')] || values[headers.indexOf('subgroupgid')] || '',
      areaId: values[headers.indexOf('area')] || values[headers.indexOf('areaid')] || '',
      timePeriod: values[headers.indexOf('timeperiod')] || values[headers.indexOf('time_period')] || '',
    };

    const dataValueIdx = headers.indexOf('datavalue') !== -1 ? headers.indexOf('datavalue') : headers.indexOf('data_value');
    if (dataValueIdx !== -1 && values[dataValueIdx]) {
      const parsed = parseFloat(values[dataValueIdx]);
      if (!isNaN(parsed)) {
        record.dataValue = parsed;
      } else {
        record.textualDataValue = values[dataValueIdx];
      }
    }

    const sourceIdx = headers.indexOf('source');
    if (sourceIdx !== -1 && values[sourceIdx]) {
      record.source = values[sourceIdx];
    }

    records.push(record);
  }

  return records;
}

export interface ImportContext {
  warehouseId: string;
  tenantId: string;
  repository: WarehouseRepository;
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
  const { warehouseId, tenantId, repository } = context;
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
    const indicator = await repository.findIndicatorByGid(record.indicatorGid, warehouseId, tenantId);
    if (!indicator) {
      result.errors.push({ row: rowNum, field: 'indicatorGid', message: `Indicator not found: ${record.indicatorGid}` });
      result.errorCount++;
      continue;
    }

    const unit = await repository.findUnitByGid(record.unitGid, warehouseId, tenantId);
    if (!unit) {
      result.errors.push({ row: rowNum, field: 'unitGid', message: `Unit not found: ${record.unitGid}` });
      result.errorCount++;
      continue;
    }

    const subgroup = await repository.findSubgroupByGid(record.subgroupGid, warehouseId, tenantId);
    if (!subgroup) {
      result.errors.push({ row: rowNum, field: 'subgroupGid', message: `Subgroup not found: ${record.subgroupGid}` });
      result.errorCount++;
      continue;
    }

    const area = await repository.findAreaByExternalId(record.areaId, warehouseId, tenantId);
    if (!area) {
      result.errors.push({ row: rowNum, field: 'areaId', message: `Area not found: ${record.areaId}` });
      result.errorCount++;
      continue;
    }

    const timePeriod = await repository.findTimePeriodByLabel(record.timePeriod, warehouseId, tenantId);
    if (!timePeriod) {
      result.errors.push({ row: rowNum, field: 'timePeriod', message: `Time period not found: ${record.timePeriod}` });
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
