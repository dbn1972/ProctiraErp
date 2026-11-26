import { NextResponse } from 'next/server';

import {
  buildTrackDobCookie,
  decideTrackLookup,
  isSecureTrackContext,
  trackLookupLocation,
} from '@/lib/track-lookup';

/**
 * POST /track/lookup
 *
 * Stores the student's date of birth in an httpOnly cookie and redirects to
 * the tracking page. The date is never placed on the query string.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const decision = decideTrackLookup(
    String(form.get('trackingNumber') ?? ''),
    String(form.get('dob') ?? ''),
  );
  // PRC-L225 / UATENV-D31: host-relative Location, never built from the request
  // Host or X-Forwarded-Host. NextResponse.redirect only takes absolute URLs, so
  // the 303 is built by hand.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: trackLookupLocation(decision) },
  });
  if (!decision.ok) {
    return response;
  }

  // PRC-L225: a `__Host-` cookie needs a secure context; use it whenever the
  // runtime is production or the request is https, else the unprefixed name.
  const secure = isSecureTrackContext(request.url, request.headers);
  const cookie = buildTrackDobCookie(decision.dob, { secure });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
