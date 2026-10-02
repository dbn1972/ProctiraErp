import { LogoutRunner } from './logout-runner';

/**
 * /logout — signs the user out with the CSRF-protected POST
 * `/api/auth/logout` (via `signOut()`), purges this browser's offline
 * caches/queues, then lands on /login (PRC-L259).
 *
 * There is deliberately no GET logout endpoint: a state-changing GET can be
 * triggered cross-site by an `<img>` or prefetch.
 */
export default function LogoutPage() {
  return <LogoutRunner />;
}
