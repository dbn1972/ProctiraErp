/**
 * Category 7 — Report export isolation tests.
 *
 * Verifies that report generation is tenant-scoped:
 *   • output rows are only the requesting tenant's data;
 *   • output file paths are namespaced under `tenants/{tenantId}/`;
 *   • multi-tenant concurrent generation never leaks rows or paths.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 26.5 (tenant-scoped report exports)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  TenantScopedReportEngine,
  assertContainsTenant,
  assertNoForeignTenant,
  assertNoForeignTenantInString,
  distinctTenantPairArb,
  distinctTenantSetArb,
  entityCodeArb,
  entityNameArb,
  uuidV4Arb,
} from '../helpers/index.js';

const recordArb = fc.record({ id: uuidV4Arb, name: entityNameArb, code: entityCodeArb });
const reportTypeArb = fc.constantFrom('institutions', 'students', 'staff', 'attendance');
const formatArb = fc.constantFrom('xlsx' as const, 'pdf' as const, 'csv' as const);

describe('Category 7 — Report Export Isolation', () => {
  let engine: TenantScopedReportEngine;

  beforeEach(() => {
    engine = new TenantScopedReportEngine();
  });

  it('a tenant`s report only contains its own rows', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(recordArb, { minLength: 1, maxLength: 5 }),
        fc.array(recordArb, { minLength: 1, maxLength: 5 }),
        reportTypeArb,
        formatArb,
        ({ tenantA, tenantB }, recordsA, recordsB, type, format) => {
          engine.clear();
          engine.seed(tenantA, recordsA);
          engine.seed(tenantB, recordsB);

          const reportA = engine.generate({ tenantId: tenantA, reportType: type, format });
          assertNoForeignTenant('report:rows', tenantA, reportA.records);
          expect(reportA.recordCount).toBe(recordsA.length);

          const reportB = engine.generate({ tenantId: tenantB, reportType: type, format });
          assertNoForeignTenant('report:rows', tenantB, reportB.records);
          expect(reportB.recordCount).toBe(recordsB.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('output paths are tenant-scoped (S3 prefix per tenant)', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        reportTypeArb,
        formatArb,
        ({ tenantA, tenantB }, type, format) => {
          engine.clear();
          const reportA = engine.generate({ tenantId: tenantA, reportType: type, format });
          const reportB = engine.generate({ tenantId: tenantB, reportType: type, format });

          expect(reportA.filePath).not.toBe(reportB.filePath);
          assertContainsTenant('report:filePath', tenantA, reportA.filePath);
          assertContainsTenant('report:filePath', tenantB, reportB.filePath);
          assertNoForeignTenantInString('report:filePath', tenantA, reportA.filePath, [tenantB]);
          assertNoForeignTenantInString('report:filePath', tenantB, reportB.filePath, [tenantA]);
          expect(reportA.filePath.startsWith(`tenants/${tenantA}/`)).toBe(true);
          expect(reportB.filePath.startsWith(`tenants/${tenantB}/`)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a tenant with no data gets an empty report — never another tenant`s rows', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(recordArb, { minLength: 1, maxLength: 8 }),
        ({ tenantA, tenantB }, recordsB) => {
          engine.clear();
          engine.seed(tenantB, recordsB);
          const report = engine.generate({
            tenantId: tenantA,
            reportType: 'students',
            format: 'xlsx',
          });

          expect(report.recordCount).toBe(0);
          expect(report.records).toEqual([]);
          assertNoForeignTenantInString('report:filePath', tenantA, report.filePath, [tenantB]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('concurrent reports across many tenants stay isolated', () => {
    fc.assert(
      fc.property(
        distinctTenantSetArb,
        fc.array(recordArb, { minLength: 1, maxLength: 4 }),
        (tenantIds, baseRows) => {
          engine.clear();
          for (let i = 0; i < tenantIds.length; i += 1) {
            engine.seed(tenantIds[i]!, baseRows.slice(0, i + 1));
          }

          const reports = tenantIds.map((id) =>
            engine.generate({ tenantId: id, reportType: 'students', format: 'csv' }),
          );

          for (let i = 0; i < reports.length; i += 1) {
            const report = reports[i]!;
            const tenantId = tenantIds[i]!;
            assertNoForeignTenant('report:concurrent', tenantId, report.records);
            assertNoForeignTenantInString(
              'report:concurrent',
              tenantId,
              report.filePath,
              tenantIds.filter((id) => id !== tenantId),
            );
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
