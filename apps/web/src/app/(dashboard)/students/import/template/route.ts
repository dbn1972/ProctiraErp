/**
 * Excel template for /students/import.
 * The gateway has no template resource (`/students/import/:jobId` treats
 * "template" as a job id), so this route builds the header row the parser expects.
 */
import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/api/gateway';
import { buildImportTemplate } from './build-template';

export async function GET(): Promise<Response> {
  const { accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const workbook = await buildImportTemplate();
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
