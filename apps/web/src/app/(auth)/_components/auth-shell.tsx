import { BarChart3, Shield, Sparkles } from 'lucide-react';

import { LanguageSelector } from '@/components/LanguageSelector';

/**
 * Shared split-screen shell for the auth flow (signup, forgot/reset password,
 * MFA), matching `redesign/web/auth-*.html`: a deep-navy brand panel on the
 * left (lg+) and the form column on the right with the language selector.
 *
 * The brand copy is intentionally tenant-agnostic; tenant branding surfaces
 * inside the individual forms.
 */
const POINTS = [
  {
    Icon: Shield,
    title: 'Secure by design',
    body: 'Role-based access, audit trails, and data residency.',
  },
  {
    Icon: BarChart3,
    title: 'Decisions backed by data',
    body: 'Live dashboards across districts, blocks, and schools.',
  },
  {
    Icon: Sparkles,
    title: 'Built for low bandwidth',
    body: 'Works on shared devices and rural connectivity.',
  },
] as const;

const STATS = [
  { value: '142', label: 'schools onboard' },
  { value: '24.8k', label: 'students managed' },
  { value: '99.95%', label: 'uptime this year' },
] as const;

export function AuthShell({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      {/* Brand panel — visible on lg+ */}
      <aside
        aria-hidden="true"
        className="relative hidden flex-1 flex-col overflow-hidden bg-gradient-to-br from-[var(--color-navy-800)] to-[var(--color-navy-950)] p-12 text-white lg:flex"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-[17px] font-extrabold">
            P
          </span>
          <b className="text-[17px] font-semibold">
            Proctira<span className="text-[var(--color-primary-400)]">ERP</span>
          </b>
        </div>

        <div className="relative z-10 flex max-w-[460px] flex-1 flex-col justify-center">
          <h2 className="mb-3.5 text-4xl font-extrabold leading-[1.15] tracking-tight">
            Every school, every student,{' '}
            <span className="text-[var(--color-primary-400)]">one platform.</span>
          </h2>
          <p className="mb-8 text-base leading-relaxed text-[#AEB9D6]">
            Unified administration for enrollment, attendance, assessments,
            scholarships, and analytics — from a single classroom to an entire
            state.
          </p>
          <div className="flex flex-col gap-3.5">
            {POINTS.map(({ Icon, title, body }) => (
              <div key={title} className="flex items-start gap-3">
                <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] border border-[rgba(99,102,241,.3)] bg-[rgba(99,102,241,.18)]">
                  <Icon className="h-4 w-4 text-[var(--color-primary-300)]" />
                </span>
                <div>
                  <b className="block text-sm font-semibold">{title}</b>
                  <span className="text-[13px] text-[#8B97B8]">{body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex gap-7">
          {STATS.map(({ value, label }) => (
            <div key={label}>
              <b className="block text-[1.375rem] font-extrabold tracking-tight">
                {value}
              </b>
              <span className="text-xs text-[#8B97B8]">{label}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Mobile brand strip */}
      <section
        aria-hidden="true"
        className="relative bg-gradient-to-br from-[var(--color-navy-800)] to-[var(--color-navy-950)] px-6 pb-10 pt-12 text-white lg:hidden"
      >
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-xl font-extrabold">
            P
          </span>
          <b className="text-xl font-semibold">
            Proctira<span className="text-[var(--color-primary-400)]">ERP</span>
          </b>
        </div>
      </section>

      {/* Form column */}
      <section className="flex flex-1 flex-col">
        <header className="flex items-center justify-end px-6 pt-6 lg:px-12">
          <LanguageSelector />
        </header>
        <div className="flex flex-1 items-center justify-center px-6 pb-12 pt-4 lg:px-12">
          {children}
        </div>
      </section>
    </div>
  );
}
