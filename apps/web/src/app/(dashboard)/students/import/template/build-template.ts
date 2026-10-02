/**
 * Student import template workbook builder (PRC-L061).
 */
import ExcelJS from 'exceljs';
import { IMPORT_GENDER_VALUES, IMPORT_TEMPLATE_COLUMNS, IMPORT_TEMPLATE_HEADERS } from './columns';

/** Rows (after the header) that receive date/gender data validation. */
const VALIDATED_ROWS = 1000;

function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Builds the template workbook. The parser reads only the first sheet, so the
 * illustrative example lives on a separate "Example" sheet and can never be
 * imported as a real student.
 */
export async function buildImportTemplate(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow([...IMPORT_TEMPLATE_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  const dobCol = columnLetter(IMPORT_TEMPLATE_HEADERS.indexOf('date_of_birth'));
  const genderCol = columnLetter(IMPORT_TEMPLATE_HEADERS.indexOf('gender'));
  for (let r = 2; r <= VALIDATED_ROWS + 1; r += 1) {
    sheet.getCell(`${dobCol}${r}`).dataValidation = {
      type: 'custom',
      allowBlank: true,
      formulae: [
        `AND(LEN(${dobCol}${r})=10,MID(${dobCol}${r},5,1)="-",MID(${dobCol}${r},8,1)="-")`,
      ],
      showErrorMessage: true,
      errorTitle: 'Date of birth',
      error: 'Use YYYY-MM-DD, for example 2014-06-01.',
    };
    sheet.getCell(`${genderCol}${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${IMPORT_GENDER_VALUES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Gender',
      error: `Use one of: ${IMPORT_GENDER_VALUES.join(', ')}.`,
    };
  }
  sheet.getColumn(dobCol).numFmt = '@';
  const example = workbook.addWorksheet('Example');
  example.addRow([...IMPORT_TEMPLATE_HEADERS]);
  example.addRow(IMPORT_TEMPLATE_COLUMNS.map((c) => c.example));
  example.addRow([]);
  example.addRow(['This sheet is for reference only and is not imported.']);
  return workbook;
}
