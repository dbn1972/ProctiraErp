/**
 * Duplicate Detection for Student Import
 *
 * Detects duplicates against existing records using configured unique identifiers:
 * 1. National ID match (exact match)
 * 2. Name + Date of Birth match (first name + last name + DOB)
 *
 * Requirements:
 * - 6.8: Duplicate detection on configured unique identifiers (national ID, name+DOB)
 * - 19.5: Flag duplicates and allow user to choose: skip, update, or create
 */

import type { ImportStudentRow, DuplicateMatch, StudentRepository } from './types.js';

/**
 * Detect duplicates for a batch of import rows against existing records.
 *
 * Checks two configured unique identifiers:
 * 1. National ID - exact match (case-insensitive)
 * 2. Name + DOB - combination of first name, last name, and date of birth
 *
 * @param tenantId - The tenant context
 * @param rows - Validated import rows (only rows that passed validation)
 * @param repository - Student repository for lookups
 * @returns Array of duplicate matches
 */
export async function detectDuplicates(
  tenantId: string,
  rows: ImportStudentRow[],
  repository: StudentRepository,
): Promise<DuplicateMatch[]> {
  const duplicates: DuplicateMatch[] = [];

  for (const row of rows) {
    // Check 1: National ID match
    if (row.nationalId) {
      const existing = await repository.findByNationalId(tenantId, row.nationalId);
      if (existing) {
        duplicates.push({
          rowNumber: row.rowNumber,
          existingStudentId: existing.id,
          matchType: 'national_id',
          matchedFields: {
            national_id: row.nationalId,
          },
        });
        // If national ID matches, skip name+DOB check for this row
        continue;
      }
    }

    // Check 2: Name + DOB match
    const matches = await repository.findByNameAndDob(
      tenantId,
      row.firstName.trim(),
      row.lastName.trim(),
      row.dateOfBirth,
    );

    const firstMatch = matches[0];
    if (firstMatch) {
      duplicates.push({
        rowNumber: row.rowNumber,
        existingStudentId: firstMatch.id,
        matchType: 'name_dob',
        matchedFields: {
          first_name: row.firstName,
          last_name: row.lastName,
          date_of_birth: row.dateOfBirth,
        },
      });
    }
  }

  return duplicates;
}
