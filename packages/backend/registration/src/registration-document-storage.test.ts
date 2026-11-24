/**
 * PRC-M330 / topic 18: admission documents are malware-scanned before they are
 * stored. An infected upload (EICAR) is refused and never written, so it can
 * never be downloaded; production without a scanner refuses every upload.
 */
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';

import { AppError } from '@proctira/common';
import { ClamdMalwareScanner } from '@proctira/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createRegistrationDocumentStorage } from './registration-document-storage.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Minimal clamd INSTREAM double: reports EICAR as found, anything else OK. */
let server: Server;
let port = 0;
beforeAll(async () => {
  server = createServer((socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (data: Buffer) => {
      received = Buffer.concat([received, data]);
      if (received.subarray(-4).equals(Buffer.alloc(4))) {
        const verdict = received.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
          ? 'stream: Eicar-Test-Signature FOUND'
          : 'stream: OK';
        socket.end(`${verdict}\0`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeAdapter() {
  return { upload: vi.fn(async (key: string) => ({ key: `tenants/t1/${key}` })) };
}
const doc = (bytes: Buffer) => ({
  tenantId: 't1',
  key: 'registration/birth_certificate/a.pdf',
  bytes,
  contentType: 'application/pdf',
});

describe('registration document storage scans before storing (PRC-M330)', () => {
  it('refuses an EICAR upload with 422 and never stores it', async () => {
    const adapter = fakeAdapter();
    const storage = createRegistrationDocumentStorage(
      adapter,
      new ClamdMalwareScanner({ host: '127.0.0.1', port }),
    );
    const err = await storage.putDocument(doc(Buffer.from(EICAR))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(422);
    expect((err as AppError).code).toBe('DOCUMENT_INFECTED');
    expect(adapter.upload).not.toHaveBeenCalled();
  });

  it('stores a clean upload', async () => {
    const adapter = fakeAdapter();
    const storage = createRegistrationDocumentStorage(
      adapter,
      new ClamdMalwareScanner({ host: '127.0.0.1', port }),
    );
    const key = await storage.putDocument(doc(Buffer.from('%PDF-1.7 clean')));
    expect(key).toBe('tenants/t1/registration/birth_certificate/a.pdf');
    expect(adapter.upload).toHaveBeenCalledTimes(1);
  });

  it('refuses uploads with 503 when the scanner is unreachable', async () => {
    const adapter = fakeAdapter();
    const storage = createRegistrationDocumentStorage(
      adapter,
      new ClamdMalwareScanner({ host: '127.0.0.1', port: 1, timeoutMs: 2000 }),
    );
    const err = await storage.putDocument(doc(Buffer.from('%PDF-1.7'))).catch((e: unknown) => e);
    expect((err as AppError).statusCode).toBe(503);
    expect(adapter.upload).not.toHaveBeenCalled();
  });

  it('fails closed in production when CLAMAV_HOST is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLAMAV_HOST', '');
    const adapter = fakeAdapter();
    const storage = createRegistrationDocumentStorage(adapter);
    const err = await storage.putDocument(doc(Buffer.from('%PDF-1.7'))).catch((e: unknown) => e);
    expect((err as AppError).statusCode).toBe(503);
    expect((err as AppError).code).toBe('DOCUMENT_SCAN_UNAVAILABLE');
    expect(adapter.upload).not.toHaveBeenCalled();
  });
});
