/**
 * G-914 — authenticated proxy for student profile photos (GET) and the
 * multipart upload endpoint (POST, PRC-L076).
 */
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import {
  GATEWAY_API_PREFIX,
  GATEWAY_BASE_URL,
  GatewayError,
  getSessionContext,
  tenantHeader,
} from '@/lib/api/gateway';
import { uploadStudentPhoto } from '@/lib/api/students';
import {
  STUDENT_PHOTO_MAX_BYTES,
  STUDENT_PHOTO_TOO_LARGE_MESSAGE,
  studentPhotoProblem,
  type STUDENT_PHOTO_MIME_TYPES,
} from '@/lib/validation/student-360-schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Invalid id' }, { status: 400 });
  }

  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const upstream = await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/students/${id}/photo`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...tenantHeader(tenantId) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (contentType.includes('application/json')) {
    const payload = (await upstream.json()) as { url?: string };
    if (payload.url) {
      return NextResponse.redirect(payload.url);
    }
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, no-store',
    },
  });
}

/** Multipart overhead allowance on top of the photo bytes (boundaries, part headers). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function problem(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status });
}

/**
 * PRC-L076 — multipart photo upload.
 *
 * The browser posts `multipart/form-data` (field `photo`) instead of a
 * base64 server-action payload, so the 2 MB limit is enforced on raw bytes
 * with a clear 413/415 before anything is buffered upstream. The gateway's
 * photo contract is still JSON/base64, so the BFF converts once, server-side.
 * CSRF is enforced for this unsafe method by middleware (`/api/*`).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) return problem(400, 'VALIDATION_ERROR', 'Invalid id');

  const { accessToken } = await getSessionContext();
  if (!accessToken) return problem(401, 'UNAUTHENTICATED', 'Sign in');

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > STUDENT_PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return problem(413, 'PAYLOAD_TOO_LARGE', STUDENT_PHOTO_TOO_LARGE_MESSAGE);
  }
  if (!(request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    return problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload the photo as multipart/form-data.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return problem(400, 'VALIDATION_ERROR', 'The photo could not be read.');
  }
  const file = form.get('photo');
  if (!(file instanceof Blob)) return problem(400, 'VALIDATION_ERROR', 'Photo is required');
  const issue = studentPhotoProblem(file);
  if (issue) {
    const status = file.size > STUDENT_PHOTO_MAX_BYTES ? 413 : 415;
    return problem(status, status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNSUPPORTED_MEDIA_TYPE', issue);
  }

  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  try {
    await uploadStudentPhoto(id, {
      contentBase64,
      mimeType: file.type as (typeof STUDENT_PHOTO_MIME_TYPES)[number],
    });
  } catch (error) {
    if (error instanceof GatewayError) {
      return problem(error.status || 502, error.code, error.message);
    }
    return problem(502, 'UPSTREAM_ERROR', 'Failed to upload photo');
  }
  revalidatePath(`/students/${id}`);
  revalidatePath('/students');
  return NextResponse.json({ status: 'success', message: 'Photo uploaded.' }, { status: 201 });
}
