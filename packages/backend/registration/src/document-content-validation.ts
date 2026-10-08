/**
 * NEW-g4_apps_auth-006 — server-side document content validation.
 *
 * Admission uploads were metadata-only: `fileType`/`fileSize` were client
 * declared and the base64 `content` was hashed then discarded, so a required
 * identity document (a minor's birth certificate / ID) could be "uploaded"
 * with no bytes at all. This module decodes the submitted bytes and verifies
 * them against the declared MIME type by inspecting the file's magic bytes, so
 * a declared `image/png` that is actually empty, text, or a mismatched type is
 * rejected. Size is measured from the real decoded bytes, not the client value.
 */
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from './schemas.js';

export type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

export interface SniffResult {
  ok: boolean;
  /** Actual byte length of the decoded content. */
  byteLength: number;
  reason?: string;
}

/** True when `bytes` starts with every byte of `signature`. */
function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/** ASCII magic (e.g. '%PDF-', 'GIF8') at the start. */
function startsWithAscii(bytes: Buffer, magic: string): boolean {
  if (bytes.length < magic.length) return false;
  return bytes.subarray(0, magic.length).toString('latin1') === magic;
}

/**
 * Verify decoded bytes match the declared MIME type via magic bytes.
 * Returns false for an empty buffer or a mismatch.
 */
export function matchesDeclaredType(bytes: Buffer, declared: string): boolean {
  if (bytes.length === 0) return false;
  switch (declared) {
    case 'image/jpeg':
      // FF D8 FF
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      // 89 50 4E 47 0D 0A 1A 0A
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a');
    case 'application/pdf':
      return startsWithAscii(bytes, '%PDF-');
    case 'application/msword':
      // Legacy OLE compound document (.doc): D0 CF 11 E0 A1 B1 1A E1
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      // .docx is a ZIP container: 50 4B 03 04 (also 05 06 / 07 08 for empty/spanned)
      return (
        startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
      );
    default:
      return false;
  }
}

/** Decode base64 content and validate type + size against the real bytes. */
export function sniffDocumentContent(contentBase64: string, declaredType: string): SniffResult {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(contentBase64, 'base64');
  } catch {
    return { ok: false, byteLength: 0, reason: 'content is not valid base64' };
  }
  if (bytes.length === 0) {
    return { ok: false, byteLength: 0, reason: 'uploaded file is empty' };
  }
  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      byteLength: bytes.length,
      reason: `file is ${bytes.length} bytes, exceeds the ${MAX_FILE_SIZE_BYTES}-byte limit`,
    };
  }
  if (!ALLOWED_FILE_TYPES.includes(declaredType as AllowedFileType)) {
    return {
      ok: false,
      byteLength: bytes.length,
      reason: `file type '${declaredType}' is not allowed`,
    };
  }
  if (!matchesDeclaredType(bytes, declaredType)) {
    return {
      ok: false,
      byteLength: bytes.length,
      reason: `file content does not match the declared type '${declaredType}'`,
    };
  }
  return { ok: true, byteLength: bytes.length };
}
