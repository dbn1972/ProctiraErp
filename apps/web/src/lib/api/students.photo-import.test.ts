/**
 * PRC-L076: studentHasPhoto must probe without downloading the photo body and
 * with a bounded timeout; oversized bulk imports are rejected before upload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'tok' }) }),
  headers: () => ({ get: () => null }),
}));
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIES: { ACCESS_TOKEN: 'access_token' },
  decodeTokenPayload: () => ({ tenantId: 'tenant-1' }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  MAX_STUDENT_IMPORT_BYTES,
  base64DecodedSize,
  studentHasPhoto,
  submitBulkImport,
  validateBulkImportSize,
} from './students';

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('studentHasPhoto', () => {
  it('uses HEAD with a timeout signal and never reads the body', async () => {
    const cancel = vi.fn(async () => undefined);
    const json = vi.fn();
    const blob = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, body: { cancel }, json, blob });

    await expect(studentHasPhoto('stu/1')).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/students/stu%2F1/photo');
    expect(init.method).toBe('HEAD');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)['X-Tenant-ID']).toBe('tenant-1');
    expect(cancel).toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(blob).not.toHaveBeenCalled();
  });

  it('returns false on 404 and on network/timeout errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, body: null });
    await expect(studentHasPhoto('s')).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    await expect(studentHasPhoto('s')).resolves.toBe(false);
  });
});

describe('bulk import size limit', () => {
  it('computes decoded size from base64', () => {
    expect(base64DecodedSize(btoa('abcd'))).toBe(4);
    expect(base64DecodedSize(btoa('abcde'))).toBe(5);
  });

  it('accepts files within the limit', () => {
    expect(validateBulkImportSize(btoa('small file'))).toBeNull();
  });

  it('rejects oversized imports with a clear message and does not post', async () => {
    const oversized = 'A'.repeat(Math.ceil(((MAX_STUDENT_IMPORT_BYTES + 3) * 4) / 3));
    expect(validateBulkImportSize(oversized)).toMatch(/larger than 50 MB/);
    await expect(
      submitBulkImport({
        fileBase64: oversized,
        fileName: 'big.xlsx',
        mimeType: 'application/octet-stream',
        duplicateResolution: 'skip',
      }),
    ).rejects.toThrow(/larger than 50 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
