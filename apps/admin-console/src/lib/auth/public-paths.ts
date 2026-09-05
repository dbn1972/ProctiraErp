/** Routes that do not require an admin session cookie. */
export const PUBLIC_PATHS = [
  '/login',
  '/forbidden',
  '/api/auth/login',
  '/api/auth/logout',
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
