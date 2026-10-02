/**
 * PRC-H093 — bulk-import HTTP contract via app.inject: multipart upload,
 * explicit base64 JSON decoding, dry-run /validate, /template download,
 * oversize / wrong-type rejection.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExcelWorkbook, EXPECTED_HEADERS, parseExcelBuffer } from './excel-parser.js';
import { InMemoryImportQueue } from './in-memory-import-queue.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import { registerImportRoutes } from './import-routes.js';
import { ImportService } from './import-service.js';
import { MAX_IMPORT_FILE_SIZE } from './types.js';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function validXlsx(): Promise<Buffer> {
  const workbook = await createExcelWorkbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(['first_name', 'last_name', 'date_of_birth', 'national_id']);
  sheet.addRow(['Asha', 'Rao', '2012-04-11', 'NID-H093-1']);
  sheet.addRow(['Ravi', 'Kumar', '2011-09-02', 'NID-H093-2']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function multipartBody(
  file: { buffer: Buffer; filename: string; mimetype: string },
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----proctiraH093Boundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.mimetype}\r\n\r\n`,
    ),
    file.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('PRC-H093 student import routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryStudentRepository;

  beforeEach(async () => {
    app = Fastify({ bodyLimit: MAX_IMPORT_FILE_SIZE * 2 });
    repository = new InMemoryStudentRepository();
    const importService = new ImportService({
      studentRepository: repository,
      importQueue: new InMemoryImportQueue(),
    });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
    });
    await registerImportRoutes(app, { importService });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('multipart upload of a valid xlsx returns 200 and creates students', async () => {
    const { payload, headers } = multipartBody(
      { buffer: await validXlsx(), filename: 'students.xlsx', mimetype: XLSX_MIME },
      { duplicateResolution: 'skip' },
    );
    const res = await app.inject({ method: 'POST', url: '/students/import', payload, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ totalRows: 2, successCount: 2, errorCount: 0 });
    expect(
      repository
        .getAll()
        .map((s) => s.firstName)
        .sort(),
    ).toEqual(['Asha', 'Ravi']);
  });

  it('POST /students/import/validate is a dry run (no students created)', async () => {
    const { payload, headers } = multipartBody({
      buffer: await validXlsx(),
      filename: 'students.xlsx',
      mimetype: XLSX_MIME,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/students/import/validate',
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ totalRows: 2, errorCount: 0 });
    expect(repository.getAll()).toHaveLength(0);
  });

  it('legacy JSON variant decodes base64 explicitly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/students/import',
      payload: {
        file: {
          buffer: (await validXlsx()).toString('base64'),
          filename: 'students.xlsx',
          mimetype: XLSX_MIME,
        },
        duplicateResolution: 'skip',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ successCount: 2 });
    expect(repository.getAll()).toHaveLength(2);
  });

  it('GET /students/import/template returns an xlsx whose headers equal EXPECTED_HEADERS', async () => {
    const res = await app.inject({ method: 'GET', url: '/students/import/template' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);
    const workbook = await createExcelWorkbook();
    await workbook.xlsx.load(res.rawPayload);
    const headers: string[] = [];
    workbook.worksheets[0]!.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = String(cell.value);
    });
    expect(headers).toEqual([...EXPECTED_HEADERS]);
    const parsed = await parseExcelBuffer(res.rawPayload);
    expect(parsed.headerErrors).toEqual([]);
  });

  it('oversize upload returns 413', async () => {
    const big = Buffer.alloc(MAX_IMPORT_FILE_SIZE + 1024, 0x41);
    big.write('PK', 0, 'latin1');
    const { payload, headers } = multipartBody({
      buffer: big,
      filename: 'big.xlsx',
      mimetype: XLSX_MIME,
    });
    const res = await app.inject({ method: 'POST', url: '/students/import', payload, headers });
    expect(res.statusCode).toBe(413);
    expect(repository.getAll()).toHaveLength(0);
  });

  it('wrong-type upload returns 400', async () => {
    const { payload, headers } = multipartBody({
      buffer: Buffer.from('first_name,last_name\nA,B\n'),
      filename: 'students.csv',
      mimetype: 'text/csv',
    });
    const res = await app.inject({ method: 'POST', url: '/students/import', payload, headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_FILE_TYPE');

    const spoofed = multipartBody({
      buffer: Buffer.from('not a zip at all'),
      filename: 'students.xlsx',
      mimetype: XLSX_MIME,
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/students/import',
      payload: spoofed.payload,
      headers: spoofed.headers,
    });
    expect(res2.statusCode).toBe(400);
  });

  it('missing file returns 400 FILE_REQUIRED', async () => {
    const res = await app.inject({ method: 'POST', url: '/students/import', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FILE_REQUIRED');
  });
});
