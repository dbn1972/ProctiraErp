/**
 * Administration landing page.
 *
 * Validates: Requirement 4.x — tenant administration entry point.
 */
import Link from 'next/link';
import {
  Building2,
  KeyRound,
  ShieldCheck,
  UserCircle,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

const sections = [
  {
    href: '/admin/users',
    title: 'Users',
    description: 'Invite teammates, manage status, and assign roles.',
    icon: UserCircle,
  },
  {
    href: '/admin/roles',
    title: 'Roles',
    description: 'Create roles and bundle them into named role sets.',
    icon: ShieldCheck,
  },
  {
    href: '/admin/permissions',
    title: 'Permissions',
    description: 'Inspect granular permissions and role coverage.',
    icon: KeyRound,
  },
  {
    href: '/admin/tenant',
    title: 'Tenant',
    description: 'Configure tenant identity, locales, and branding.',
    icon: Building2,
  },
];

export default function AdminLandingPage() {
  return (
    <section aria-labelledby="admin-heading" className="space-y-6">
      <header>
        <h1 id="admin-heading" className="text-2xl font-semibold tracking-tight">
          Administration
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage users, roles, permissions, and tenant configuration.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{section.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
