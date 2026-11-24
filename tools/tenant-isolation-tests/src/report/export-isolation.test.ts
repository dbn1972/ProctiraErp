/**
 * Category 7 — Report export isolation tests.
 *
 * PRC-M614: drives the product report catalogue (`@proctira/backend-report`
 * `CatalogueService` with its in-memory run/artifact store and blob store, the
 * same classes the gateway falls back to without Postgres). It verifies that:
 *   • stored export files are namespaced under `{tenantId}/reports/`;
 *   • another tenant can neither read the artifact record nor download it;
 *   • run listings only show the caller tenant's runs, also when many tenants
 *     export concurrently.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 26.5 (tenant-scoped report exports)
 */
import {
  CatalogueService,
  InMemoryReportBlobStore,
  InMemoryReportStore,
} from '@proctira/backend-report';
import * as fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertContainsTenant,
  assertNoForeignTenant,
  assertNoForeignTenantInString,
  distinctTenantPairArb,
  distinctTenantSetArb,
} from '../helpers/index.js';

const reportKeyArb = fc.constantFrom('students_roster', 'attendance_summary', 'enrolment_by_grade');

function productCatalogue() {
  const store = new InMemoryReportStore();
  const blobs = new InMemoryReportBlobStore();
  return { store, blobs, service: new CatalogueService(store, blobs) };
}

const savedDemo = process.env['REPORT_DEMO_DATA'];
beforeAll(() => {
  // No database here: the catalogue providers serve their explicit demo rows (PRC-H080).
  process.env['REPORT_DEMO_DATA'] = '1';
});
afterAll(() => {
  if (savedDemo === undefined) delete process.env['REPORT_DEMO_DATA'];
  else process.env['REPORT_DEMO_DATA'] = savedDemo;
});

describe('Category 7 — Report Export Isolation (product @proctira/backend-report)', () => {
  it('stored export files are namespaced under the tenant', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, reportKeyArb, async ({ tenantA, tenantB }, key) => {
        const { service } = productCatalogue();
        const a = await service.generate(tenantA, 'actor-a', { reportKey: key, format: 'csv' });
        const b = await service.generate(tenantB, 'actor-b', { reportKey: key, format: 'csv' });
        expect(a.artifact.objectKey).not.toBe(b.artifact.objectKey);
        expect(a.artifact.objectKey.startsWith(`${tenantA}/reports/`)).toBe(true);
        expect(b.artifact.objectKey.startsWith(`${tenantB}/reports/`)).toBe(true);
        assertContainsTenant('report:objectKey', tenantA, a.artifact.objectKey);
        assertNoForeignTenantInString('report:objectKey', tenantA, a.artifact.objectKey, [tenantB]);
        assertNoForeignTenantInString('report:objectKey', tenantB, b.artifact.objectKey, [tenantA]);
      }),
      { numRuns: 20 },
    );
  });

  it('another tenant cannot read or download a tenant`s artifact', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, reportKeyArb, async ({ tenantA, tenantB }, key) => {
        const { service } = productCatalogue();
        const a = await service.generate(tenantA, 'actor-a', { reportKey: key, format: 'csv' });
        await expect(service.getArtifact(tenantB, a.artifact.id)).rejects.toMatchObject({
          statusCode: 404,
        });
        await expect(service.downloadBytes(tenantB, a.artifact.id)).rejects.toMatchObject({
          statusCode: 404,
        });
        expect(await service.getArtifactsByIds(tenantB, [a.artifact.id])).toEqual([]);
        const own = await service.downloadBytes(tenantA, a.artifact.id);
        expect(own.bytes.equals(a.bytes)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('a tenant with no exports lists no runs — never another tenant`s', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, async ({ tenantA, tenantB }) => {
        const { service } = productCatalogue();
        await service.generate(tenantB, 'actor-b', {
          reportKey: 'students_roster',
          format: 'csv',
        });
        expect(await service.listRuns(tenantA)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

  it('concurrent exports across many tenants stay isolated', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantSetArb, async (tenantIds) => {
        const { service } = productCatalogue();
        const results = await Promise.all(
          tenantIds.map((tenantId, i) =>
            service.generate(tenantId, `actor-${i}`, {
              reportKey: 'students_roster',
              format: 'csv',
            }),
          ),
        );
        for (let i = 0; i < tenantIds.length; i += 1) {
          const tenantId = tenantIds[i]!;
          const others = tenantIds.filter((id) => id !== tenantId);
          const runs = await service.listRuns(tenantId);
          expect(runs).toHaveLength(1);
          assertNoForeignTenant('report:runs', tenantId, runs);
          assertNoForeignTenantInString(
            'report:objectKey',
            tenantId,
            results[i]!.artifact.objectKey,
            others,
          );
        }
      }),
      { numRuns: 10 },
    );
  });
});
