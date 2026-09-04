/**
 * Administration landing page.
 *
 * Layout per redesign/web/admin-overview.html — settings grid of admin
 * modules including users, roles, policies, custom fields, and notification
 * rules.
 *
 * Validates: Requirement 4.x — tenant administration entry point.
 */
import Link from 'next/link';
import {
  Bell,
  Building2,
  ChevronRight,
  ClipboardList,
  FormInput,
  KeyRound,
  ScrollText,
  ShieldCheck,
  UserCircle,
} from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

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
    href: '/admin/policies',
    title: 'Access policies',
    description:
      'Versioned rules controlling who can view, edit, and export records across the district.',
    icon: ScrollText,
    iconClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  },
  {
    href: '/admin/custom-fields',
    title: 'Custom fields',
    description:
      'Extend student, staff, and institution records with district-specific data points.',
    icon: FormInput,
    iconClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  },
  {
    href: '/admin/registration-forms',
    title: 'Registration forms',
    description:
      'Configure custom application fields per institution type for the public portal.',
    icon: ClipboardList,
    iconClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  },
  {
    href: '/admin/notification-rules',
    title: 'Notification rules',
    description:
      'Map system events to audiences, channels, and templates for attendance and exam alerts.',
    icon: Bell,
    iconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  },
  {
    href: '/admin/tenant',
    title: 'Tenant settings',
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
            Manage users, roles, policies, custom fields, and tenant
            configuration.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/users">
            Invite user
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
