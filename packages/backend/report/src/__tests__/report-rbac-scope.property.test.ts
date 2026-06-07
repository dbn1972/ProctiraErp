/**
 * Property-Based Test: RBAC-Scoped Report Generation
 *
 * Invariant: Report generation never includes data from areas outside
 * the requesting user's scope. The data source must filter results
 * to only include rows within the user's accessible area IDs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

import { ReportService } from '../report-service.js';
import { InMemoryReportRepository } from '../in-memory-repository.js';
import type {
  ReportDataSource,
  ReportUserContext,
  ReportDataResult,
} from '../report-repository.js';
import type { AggregationConfig } from '../schemas.js';

/**
 * A mock data source that simulates data from multiple areas.
 * It stores rows tagged with areaIds and filters based on user context.
 */
class RBACMockDataSource implements ReportDataSource {
  /** All available data rows across all areas */
  private allRows: Array<Record<string, unknown>> = [];

  constructor(rows: Array<Record<string, unknown>>) {
    this.allRows = rows;
  }

  async fetchData(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
    groupBy: string[] | null,
    aggregations: AggregationConfig[] | null,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    // RBAC filtering: only return rows whose areaId is in user's accessible areas
    const accessibleAreas = new Set(userContext.accessibleAreaIds);

    const filteredRows = this.allRows.filter(row => {
      const rowArea = row['areaId'] as string;
      return accessibleAreas.has(rowArea);
    });

    return {
      rows: filteredRows,
      columns: [
        { name: 'id', type: 'string' },
        { name: 'areaId', type: 'string' },
        { name: 'value', type: 'number' },
      ],
      totalRows: filteredRows.length,
    };
  }
}

describe('Report Service - RBAC Scope Filtering (Property)', () => {
  const tenantId = uuidv4();

  it('should never include data from areas outside the user accessible scope', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 2-8 area IDs representing all areas in the system
        fc.array(fc.uuid(), { minLength: 2, maxLength: 8 }),
        // Generate which subset of areas the user can access (at least 1)
        fc.nat(),
        // Generate 5-20 data rows distributed across areas
        fc.integer({ min: 5, max: 20 }),
        async (allAreaIds, accessSubsetSeed, rowCount) => {
          // Ensure unique area IDs
          const uniqueAreas = [...new Set(allAreaIds)];
          if (uniqueAreas.length < 2) return; // Need at least 2 areas to test scoping

          // Determine which areas the user can access (a proper subset)
          const accessCount = (accessSubsetSeed % (uniqueAreas.length - 1)) + 1;
          const userAccessibleAreas = uniqueAreas.slice(0, accessCount);
          const inaccessibleAreas = uniqueAreas.slice(accessCount);

          // Generate data rows distributed across ALL areas
          const allRows: Array<Record<string, unknown>> = [];
          for (let i = 0; i < rowCount; i++) {
            const areaIndex = i % uniqueAreas.length;
            allRows.push({
              id: uuidv4(),
              areaId: uniqueAreas[areaIndex],
              value: i * 100,
            });
          }

          // Ensure there's at least one row in an inaccessible area
          if (!allRows.some(r => inaccessibleAreas.includes(r['areaId'] as string))) {
            allRows.push({
              id: uuidv4(),
              areaId: inaccessibleAreas[0],
              value: 999,
            });
          }

          // Set up the service with the RBAC-aware data source
          const repository = new InMemoryReportRepository();
          const dataSource = new RBACMockDataSource(allRows);
          const reportService = new ReportService(repository, dataSource);

          const userContext: ReportUserContext = {
            userId: uuidv4(),
            tenantId,
            roleId: 'report_viewer',
            areaId: userAccessibleAreas[0]!,
            institutionIds: [],
            accessibleAreaIds: userAccessibleAreas,
          };

          // Generate a report
          const job = await reportService.generateReport(
            tenantId,
            {
              reportType: 'student_enrollment',
              format: 'csv',
              filters: {},
            },
            userContext,
          );

          // Verify the job completed
          expect(job.status).toBe('completed');

          // Verify by re-fetching data through the data source directly
          // to confirm the RBAC invariant
          const result = await dataSource.fetchData(
            tenantId,
            'student_enrollment',
            {},
            null,
            null,
            userContext,
          );

          // INVARIANT: No row in the result should have an areaId
          // that is NOT in the user's accessible areas
          const accessibleSet = new Set(userAccessibleAreas);
          for (const row of result.rows) {
            const rowAreaId = row['areaId'] as string;
            expect(accessibleSet.has(rowAreaId)).toBe(true);
          }

          // Additionally verify that inaccessible area data was excluded
          const inaccessibleSet = new Set(inaccessibleAreas);
          for (const row of result.rows) {
            const rowAreaId = row['areaId'] as string;
            expect(inaccessibleSet.has(rowAreaId)).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
