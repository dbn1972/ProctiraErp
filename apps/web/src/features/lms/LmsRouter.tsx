/**
 * LmsRouter — sub-router for the LMS feature module in the federated shell.
 *
 * The App Router pages under `src/app/(dashboard)/lms` are the primary
 * surface; this router keeps the `/app/lms/*` federated mount valid by
 * redirecting each sub-route to its server-rendered counterpart.
 *
 * Wave 8 — FR-UX-001…005.
 */

import { Route, Routes } from 'react-router-dom';

function RedirectTo({ href }: { href: string }) {
  if (typeof window !== 'undefined') window.location.replace(href);
  return (
    <div role="status" aria-live="polite" className="p-6 text-muted-foreground">
      <a href={href}>{href}</a>
    </div>
  );
}

export default function LmsRouter() {
  return (
    <Routes>
      <Route index element={<RedirectTo href="/lms" />} />
      <Route path="pal" element={<RedirectTo href="/lms/pal" />} />
      <Route path="assignments/new" element={<RedirectTo href="/lms/assignments/new" />} />
      <Route path="*" element={<RedirectTo href="/lms" />} />
    </Routes>
  );
}
