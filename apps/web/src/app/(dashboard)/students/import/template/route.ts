/**
 * Excel template for /students/import.
 * The gateway has no template resource (`/students/import/:jobId` treats
 * "template" as a job id), so this route builds the header row the parser expects.
 */
import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/api/gateway';

const HEADERS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'gender',
  'national_id',
  'nationality',
  'contact_phone',
  'contact_email',
  'guardian_name',
  'guardian_phone',
  'institution_code',
] as const;

export async function GET(): Promise<Response> {
  const { accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow([...HEADERS]);
  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="students-import-template.xlsx"',
      'cache-control': 'no-store',
    },
  });
}
