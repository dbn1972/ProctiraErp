import { Suspense } from 'react';
import { LoginForm } from './login-form';
import { LanguageSelector } from '@/components/LanguageSelector';

/**
 * Login page (Server Component). Renders the split-screen layout described
 * in the Figma prompts (05-login-desktop.md, 06-login-mobile.md): a deep
 * navy hero on the left for desktop, with the credential form on the right.
 *
 * Authentication interactions live in the client `LoginForm` component.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      {/* Hero panel — visible on lg+ */}
      <section
        aria-hidden="true"
        className="relative hidden flex-1 flex-col justify-between bg-gradient-to-br from-[var(--color-navy-800)] to-[var(--color-navy-950)] p-12 text-white lg:flex"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-lg font-extrabold">
            P
          </div>
          <span className="text-xl font-semibold tracking-tight">
            Proctira
            <span className="text-[var(--color-primary-400)]">ERP</span>
          </span>
        </div>

        <div className="space-y-3">
          <h2 className="text-4xl font-extrabold tracking-tight">
            Every school, every student,{' '}
            <span className="text-[var(--color-primary-400)]">
              one platform.
            </span>
          </h2>
          <p className="max-w-md text-sm text-white/70">
            One platform for institutions, students, staff, attendance,
            assessment, examinations, scholarships, and analytics.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Schools" value="12,000+" />
          <StatCard label="Students" value="2.5M" />
          <StatCard label="Teachers" value="85,000" />
        </div>
      </section>

      {/* Mobile hero (compact) */}
      <section
        aria-hidden="true"
        className="relative bg-gradient-to-br from-[var(--color-navy-800)] to-[var(--color-navy-950)] px-6 pb-10 pt-12 text-white lg:hidden"
      >
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-xl font-extrabold">
            P
          </div>
          <span className="text-xl font-semibold tracking-tight">
            Proctira
            <span className="text-[var(--color-primary-400)]">ERP</span>
          </span>
          <p className="mt-1 text-sm text-white/70">Education Management</p>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex flex-1 flex-col">
        <header className="flex items-center justify-end px-6 pt-6 lg:px-12">
          <LanguageSelector />
        </header>
        <div className="flex flex-1 items-center justify-center px-6 pb-12 pt-4 lg:px-12">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-lg bg-white/10 p-4 backdrop-blur-sm">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-white/70">{label}</div>
    </div>
  );
}
