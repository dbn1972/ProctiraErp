/**
 * Administration landing page.
 *
 * Validates: Requirement 4.x — tenant administration entry point.
 */
import Link from 'next/link';
import {
  Building2,
  ChevronRight,
  KeyRound,
  ShieldCheck,
  UserCircle,
} from 'lucide-react';

import {
  Card,
  CardContent,
} from '@proctira/ui/components';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

const sections = [
  {
    href: '/admin/users',
    title: 'Users',
    description:
      'Invite staff, manage account status, reset MFA, and assign roles across institutions.',
    icon: UserCircle,
    iconClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  {
    href: '/admin/roles',
    title: 'Roles',
    description:
      'Bundle permissions into named roles like Headmaster or Clerk, then assign them to users.',
    icon: ShieldCheck,
    iconClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  },
  {
    href: '/admin/permissions',
    title: 'Permissions',
    description:
      'Inspect granular permissions across modules and review role coverage in the matrix.',
    icon: KeyRound,
    iconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  },
  {
    href: '/admin/tenant',
    title: 'Tenant',
    description:
      'Institution identity, district mapping, academic year defaults, locale, timezone, and branding.',
    icon: Building2,
    iconClass: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  },
];

export default function AdminLandingPage() {
  return (
    <section aria-labelledby="admin-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="admin-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Administration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage users, roles, permissions, and tenant configuration.
          </p>
        </div>
      </div>

      <ScaffoldModeBanner
        force
        surface="Administration"
        detail="Admin hub and nested settings are UI scaffolds. Nested lists stay empty when tenant admin APIs are offline rather than inventing accounts."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${section.iconClass}`}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h2 className="text-lg font-bold tracking-tight">
                      {section.title}
                    </h2>
                    <ChevronRight
                      className="ms-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {section.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
