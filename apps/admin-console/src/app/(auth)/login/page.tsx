import { Suspense } from 'react';
import { LoginForm } from './login-form';

/** Platform admin login page. */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <section
        aria-hidden="true"
        className="relative hidden flex-1 flex-col justify-between bg-gradient-to-br from-[hsl(222,47%,25%)] to-[hsl(222,47%,15%)] p-12 text-white lg:flex"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-lg font-bold">
            E
          </div>
          <span className="text-xl font-semibold tracking-tight">ProctiraERP</span>
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight">
            Platform Admin Console
          </h2>
          <p className="max-w-md text-sm text-white/70">
            Internal-only operations: tenant lifecycle, plan and entitlement
            management, plugin marketplace review, theme approvals, break-glass
            access controls, and system health monitoring.
          </p>
        </div>
        <div className="text-xs text-white/60">
          Section 41 · Support, Break-Glass, Internal Access
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  );
}
