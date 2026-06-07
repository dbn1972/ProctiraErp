import { redirect } from 'next/navigation';

/**
 * /logout — redirects to the API route that clears auth cookies and tells
 * the upstream auth-service to invalidate the session. The API route then
 * redirects to /login.
 */
export default function LogoutPage(): never {
  redirect('/api/auth/logout');
}
