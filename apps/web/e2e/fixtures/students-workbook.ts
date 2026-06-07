import ExcelJS from 'exceljs';

import { uniqueSuffix } from './test-data';

export interface StudentsWorkbookRow {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  email: string;
}

/**
 * Generates a small XLSX workbook in memory containing one valid row and one
 * invalid row. The invalid row uses an obviously bad date and an empty
 * required field so the import preview can flag it.
 */
export async function buildStudentsWorkbook(): Promise<{
  buffer: Buffer;
  validRow: StudentsWorkbookRow;
  invalidRow: StudentsWorkbookRow;
}> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.columns = [
    { header: 'First Name', key: 'firstName', width: 20 },
    { header: 'Last Name', key: 'lastName', width: 20 },
    { header: 'Date of Birth', key: 'dateOfBirth', width: 15 },
    { header: 'Gender', key: 'gender', width: 10 },
    { header: 'Email', key: 'email', width: 30 },
  ];

  const suffix = uniqueSuffix();
  const validRow: StudentsWorkbookRow = {
    firstName: `Valid${suffix}`,
    lastName: `Student${suffix}`,
    dateOfBirth: '2011-08-20',
    gender: 'Female',
    email: `valid.${suffix}@example.test`,
  };
  const invalidRow: StudentsWorkbookRow = {
    firstName: '',
    lastName: `Broken${suffix}`,
    dateOfBirth: 'not-a-date',
    gender: 'Unknown',
    email: 'not-an-email',
  };

  sheet.addRow(validRow);
  sheet.addRow(invalidRow);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    validRow,
    invalidRow,
  };
}
