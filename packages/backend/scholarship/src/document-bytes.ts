/**
 * Scholarship supporting-document bytes: allow-list, magic-byte sniff,
 * filename sanitisation, and a stable placeholder PDF for seeds/tests.
 * No ClamAV client exists in this repo; callers pass an optional scan hook.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { AppError, ValidationError } from '@proctira/common';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

const PDF_SIG = Buffer.from('%PDF');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);

/** Stable tiny PDF used by the Sunrise seed and unit tests (not a scanned form). */
export const PLACEHOLDER_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

export const PLACEHOLDER_PDF_SHA256 =
  '7856c8e9ef203bbcac0d98630035fd1ced46f1bdd446c940d6411e183f6073ec';

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sniffDocumentMime(bytes: Buffer): AllowedDocumentMime | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).compare(PDF_SIG) === 0) return 'application/pdf';
  if (bytes.length >= 3 && bytes.subarray(0, 3).compare(JPEG_SIG) === 0) return 'image/jpeg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).compare(PNG_SIG) === 0) return 'image/png';
  return null;
}

/**
 * Keep a single path segment. Strips directories, NUL, and characters that
 * are unsafe in Content-Disposition and object keys.
 */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/\0/g, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'document';
}

export function assertDocumentBytes(
  bytes: Buffer,
  declaredMime: string | undefined,
): AllowedDocumentMime {
  if (bytes.length === 0) {
    throw new ValidationError('Document is empty', [
      { field: 'file', rule: 'minLength', message: 'Document is empty' },
    ]);
  }
  if (bytes.length > DOCUMENT_MAX_BYTES) {
    throw new ValidationError('Document exceeds 10 MB', [
      { field: 'file', rule: 'maxSize', message: 'Document must be 10 MB or smaller' },
    ]);
  }
  const sniffed = sniffDocumentMime(bytes);
  if (!sniffed) {
    throw new ValidationError('File must be a PDF, JPEG, or PNG', [
      {
        field: 'file',
        rule: 'magic',
        message: 'File content does not match PDF, JPEG, or PNG',
      },
    ]);
  }
  const declared = declaredMime?.split(';')[0]?.trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== sniffed) {
    throw new ValidationError('Document bytes do not match the declared MIME type', [
      {
        field: 'file',
        rule: 'magic',
        message: `Declared ${declared} but file content is ${sniffed}`,
      },
    ]);
  }
  if (!(ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(sniffed)) {
    throw new ValidationError('Unsupported document type', [
      { field: 'file', rule: 'enum', message: 'Document must be PDF, JPEG, or PNG' },
    ]);
  }
  return sniffed;
}

export interface MultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

/** Single-file multipart/form-data parser (documentType + file). */
export function parseMultipartForm(body: Buffer, contentType: string): ParsedMultipart {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) {
    throw new ValidationError('Upload must be multipart/form-data', [
      { field: 'file', rule: 'contentType', message: 'Missing multipart boundary' },
    ]);
  }
  const delim = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: MultipartFile | null = null;
  let cursor = body.indexOf(delim);
  if (cursor < 0) {
    throw new ValidationError('Upload must be multipart/form-data', [
      { field: 'file', rule: 'contentType', message: 'Malformed multipart body' },
    ]);
  }
  while (cursor >= 0) {
    const after = cursor + delim.length;
    if (body.subarray(after, after + 2).toString() === '--') break;
    let partStart = after;
    if (body.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const next = body.indexOf(delim, partStart);
    if (next < 0) break;
    let partEnd = next;
    if (body.subarray(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2;
    const part = body.subarray(partStart, partEnd);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headerText = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/.exec(headerText);
      const mimeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      const name = nameMatch?.[1] ?? '';
      if (filenameMatch) {
        file = {
          fieldName: name || 'file',
          filename: filenameMatch[1] ?? 'document',
          mimeType: mimeMatch?.[1]?.trim() ?? 'application/octet-stream',
          data,
        };
      } else if (name) {
        fields[name] = data.toString('utf8');
      }
    }
    cursor = next;
  }
  return { fields, file };
}

export interface DocumentDownloadClaims {
  tenantId: string;
  documentId: string;
  exp: number;
}

function signingSecret(): string {
  const configured = process.env['SCHOLARSHIP_DOC_URL_SECRET']?.trim();
  if (configured) return configured;
  // Dev/test only. Production must set SCHOLARSHIP_DOC_URL_SECRET.
  return 'dev-scholarship-doc-url-secret';
}

export function signDocumentDownloadToken(
  claims: Omit<DocumentDownloadClaims, 'exp'> & { expiresInSeconds?: number; exp?: number },
): { token: string; expiresAt: string } {
  const exp = claims.exp ?? Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 120);
  const payload: DocumentDownloadClaims = {
    tenantId: claims.tenantId,
    documentId: claims.documentId,
    exp,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyDocumentDownloadToken(
  token: string,
  nowSeconds = Date.now() / 1000,
): DocumentDownloadClaims {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  const expected = createHmac('sha256', signingSecret()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  let claims: DocumentDownloadClaims;
  try {
    claims = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    ) as DocumentDownloadClaims;
  } catch {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  if (!claims.exp || claims.exp < nowSeconds) {
    throw new AppError('Download link has expired', 'UNAUTHORIZED', 401);
  }
  if (!claims.tenantId || !claims.documentId) {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  return claims;
}
