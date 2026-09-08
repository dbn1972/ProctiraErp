/**
 * Help centre (G-404 destination, content filled in G-727).
 *
 * Static, dependency-free content: module guide index, keyboard shortcuts,
 * and support/escalation paths. Operator-depth material lives in
 * `docs/runbooks/*` in the repository; this page points at it rather than
 * duplicating it.
 */
import Link from 'next/link';
import { BookOpen, Keyboard, LifeBuoy, ShieldCheck } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';

const MODULE_GUIDES: ReadonlyArray<{ href: string; title: string; summary: string }> = [
  {
    href: '/students',
    title: 'Students',
    summary: 'Enrolment, records, transfers and bulk import.',
  },
  {
    href: '/attendance',
    title: 'Attendance',
    summary: 'Daily marking, offline queue and reports.',
  },
  {
    href: '/assessments',
    title: 'Assessments & gradebook',
    summary: 'Schemes, items, results and report cards.',
  },
  {
    href: '/examinations',
    title: 'Examinations',
    summary: 'Scheduling, candidates, documents and board exports.',
  },
  {
    href: '/fees',
    title: 'Fees',
    summary: 'Plans, invoices, receipts and the double-entry ledger.',
  },
  {
    href: '/scholarships',
    title: 'Scholarships',
    summary: 'Programs, applications and disbursements.',
  },
  {
    href: '/health',
    title: 'Health',
    summary: 'Screenings, counselling and special-needs plans (PHI).',
  },
  { href: '/hostel', title: 'Hostel', summary: 'Blocks, rooms, assignments, leaves and visitors.' },
  { href: '/transport', title: 'Transport', summary: 'Routes, vehicles and student assignments.' },
  { href: '/library', title: 'Library', summary: 'Catalogue, circulation, overdues and fines.' },
  { href: '/communication', title: 'Communication', summary: 'Campaigns and emergency blasts.' },
  {
    href: '/workflows',
    title: 'Workflows',
    summary: 'Approval definitions and running instances.',
  },
  {
    href: '/reports',
    title: 'Reports & insights',
    summary: 'Template catalogue and the report builder.',
  },
  {
    href: '/admin',
    title: 'Administration',
    summary: 'Users, roles, permissions, tenant, billing and audit.',
  },
];

const SHORTCUTS: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: '⌘ K / Ctrl K', action: 'Open the command palette (jump to any module or record)' },
  { keys: 'Esc', action: 'Close the palette, dialog or drawer' },
  {
    keys: 'Tab / Shift Tab',
    action: 'Move through controls — every action is reachable without a mouse',
  },
  { keys: 'Enter', action: 'Activate the focused button or link' },
  { keys: '/', action: 'Focus the search field on list pages that expose one' },
];

const RUNBOOKS: ReadonlyArray<{ file: string; title: string }> = [
  { file: 'install.md', title: 'Installation and upgrade' },
  { file: 'auth.md', title: 'Authentication, MFA and session issues' },
  { file: 'database-migration-rollback.md', title: 'Database migration and rollback' },
  { file: 'audit.md', title: 'Audit trail and retention' },
  { file: 'billing.md', title: 'Billing plans and entitlements' },
  { file: 'tenant.md', title: 'Tenant lifecycle' },
];

export default function HelpPage() {
  return (
    <section aria-labelledby="help-heading" className="space-y-8" data-testid="help-page">
      <DocumentTitle pageTitle="Help" />
      <div>
        <h1 id="help-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
          Help
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Module guides, keyboard shortcuts, operator runbooks and how to reach support.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Module guides</CardTitle>
            <CardDescription>Where each part of the school lives in the product.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {MODULE_GUIDES.map((guide) => (
              <li key={guide.href}>
                <Link
                  href={guide.href}
                  className="block rounded-lg border border-border p-3 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="font-semibold text-foreground">{guide.title}</p>
                  <p className="text-xs text-muted-foreground">{guide.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Keyboard className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Keyboard shortcuts</CardTitle>
              <CardDescription>The whole product is operable without a pointer.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border text-sm">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-start justify-between gap-4 py-2">
                  <dt>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {s.keys}
                    </kbd>
                  </dt>
                  <dd className="text-end text-muted-foreground">{s.action}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Operator runbooks</CardTitle>
              <CardDescription>
                Shipped with the source under <code className="text-xs">docs/runbooks/</code>.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm" role="list">
              {RUNBOOKS.map((r) => (
                <li key={r.file} className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground">{r.title}</span>
                  <code className="shrink-0 text-xs text-muted-foreground">{r.file}</code>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LifeBuoy className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Getting support</CardTitle>
            <CardDescription>What to include so the first reply is the fix.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1 ps-5">
            <li>The page address and the exact time (with timezone) of the problem.</li>
            <li>
              What you expected versus what happened; a screenshot if there was an error banner.
            </li>
            <li>Your role and institution — never share passwords or one-time codes.</li>
          </ol>
          <p>
            Tenant administrators can review recent activity under{' '}
            <Link className="underline" href="/audit-logs">
              Audit logs
            </Link>{' '}
            before escalating to the platform team. Security concerns should go straight to your
            platform administrator and be marked as such.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
