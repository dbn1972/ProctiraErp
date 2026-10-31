import { NextResponse } from 'next/server';

import { buildTrackDobCookie, decideTrackLookup, resolveRedirectBase } from '@/lib/track-lookup';

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
  // PRC-L225: build the redirect from a trusted public base, never the request Host.
  const redirectBase = resolveRedirectBase(request.url, request.headers);

  if (!decision.ok) {
    return NextResponse.redirect(new URL('/track?error=invalid', redirectBase), 303);
  }

  const response = NextResponse.redirect(
    new URL(`/track/${encodeURIComponent(decision.trackingNumber)}`, redirectBase),
    303,
  );
  // PRC-L225: a `__Host-` cookie needs HTTPS; use it whenever the resolved base
  // (or the deployed runtime) is secure, else the unprefixed name for local dev.
  const secure = redirectBase.protocol === 'https:' || process.env.NODE_ENV === 'production';
  const cookie = buildTrackDobCookie(decision.dob, { secure });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
