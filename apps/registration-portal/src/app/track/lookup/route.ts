import { NextResponse } from 'next/server';

import { decideTrackLookup, TRACK_DOB_COOKIE } from '@/lib/track-lookup';

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
  const redirectBase = new URL(request.url);

  if (!decision.ok) {
    return NextResponse.redirect(new URL('/track?error=invalid', redirectBase), 303);
  }

  const response = NextResponse.redirect(
    new URL(`/track/${encodeURIComponent(decision.trackingNumber)}`, redirectBase),
    303,
  );
  response.cookies.set(TRACK_DOB_COOKIE, decision.dob, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/track',
    maxAge: 60 * 30,
  });
  return response;
}
