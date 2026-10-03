import { describe, expect, it } from 'vitest';
import {
  assertAllowedUpload,
  contentMatchesMime,
  LMS_UPLOAD_BODY_LIMIT_BYTES,
} from './lms-file-store.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32, 0x20)]);
const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('LMS upload content sniffing (PRC-M099)', () => {
  it('accepts content whose magic bytes match the declared type', () => {
    expect(() => assertAllowedUpload('application/pdf', pdf.length, pdf)).not.toThrow();
    expect(contentMatchesMime('image/png', png)).toBe(true);
    expect(contentMatchesMime('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(contentMatchesMime('text/plain', Buffer.from('hello world\n'))).toBe(true);
    expect(
      contentMatchesMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]),
      ),
    ).toBe(true);
  });

  it('rejects an executable declared as PDF or text', () => {
    expect(() => assertAllowedUpload('application/pdf', exe.length, exe)).toThrow(
      /does not match application\/pdf/,
    );
    expect(contentMatchesMime('text/plain', exe)).toBe(false);
    expect(contentMatchesMime('image/png', pdf)).toBe(false);
  });

  it('keeps the 5 MB cap and fits a 5 MB base64 body under the route limit', () => {
    const fiveMb = 5 * 1024 * 1024;
    expect(() => assertAllowedUpload('application/pdf', fiveMb + 1, pdf)).toThrow(/5 MB/);
    expect(Math.ceil(fiveMb / 3) * 4 + 1024).toBeLessThan(LMS_UPLOAD_BODY_LIMIT_BYTES);
  });
});
