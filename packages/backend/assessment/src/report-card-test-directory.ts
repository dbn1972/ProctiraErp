/**
 * Test-only ReportCardDirectory that resolves every id in any tenant to a
 * deterministic placeholder name. Not exported from the package index; used
 * by unit tests that exercise job mechanics rather than name resolution.
 */
import type { ReportCardDirectory } from './report-card-directory.js';

export const anyIdReportCardDirectory: ReportCardDirectory = {
  async findStudentName(_tenantId, studentId) {
    return `Student ${studentId.slice(0, 8)}`;
  },
  async findSubjectNames(_tenantId, subjectIds) {
    return new Map(subjectIds.map((id) => [id, `Subject ${id.slice(0, 8)}`]));
  },
  async findAcademicPeriodName(_tenantId, academicPeriodId) {
    return `Period ${academicPeriodId.slice(0, 8)}`;
  },
};
