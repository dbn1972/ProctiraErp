import { NextResponse } from 'next/server';

import { ADMIN_AUTH_COOKIES, clearCookieOptions } from '@/lib/auth';

/** POST /api/auth/logout — clears all admin auth cookies. */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions());
  response.cookies.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions());
  response.cookies.set(ADMIN_AUTH_COOKIES.SESSION_ID, '', clearCookieOptions());
  return response;
}
