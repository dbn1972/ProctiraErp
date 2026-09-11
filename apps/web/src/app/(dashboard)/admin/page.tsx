/**
 * Administration landing page.
 *
 * Validates: Requirement 4.x — tenant administration entry point.
 * G-727 adds the platform-scoped surfaces (billing, audit logs, tenant
 * lifecycle) as a second card group.
 */
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Card, CardContent } from '@proctira/ui/components';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

import { ADMIN_SECTIONS, PLATFORM_SECTIONS, type AdminSection } from './admin-sections';

export default function AdminLandingPage() {
  return (
    <section aria-labelledby="admin-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 id="admin-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
            Administration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage users, roles, permissions, and tenant configuration.
          </p>
        </div>
      </div>

      <ScaffoldModeBanner
        force
        surface="Administration (ops stub)"
        detail="This console is an ops stub / UI scaffold — not a live billing, plugin marketplace, or control-plane console. Nested lists stay empty when tenant admin APIs are offline rather than inventing accounts, plans, or plugin installs."
      />

      <SectionGrid sections={ADMIN_SECTIONS} label="Tenant administration" />

      <section aria-labelledby="platform-heading" className="space-y-3">
        <h2
          id="platform-heading"
          className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          <span>Platform</span>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </h2>
        <SectionGrid sections={PLATFORM_SECTIONS} label="Platform administration" />
      </section>
    </section>
  );
}

function SectionGrid({ sections, label }: { sections: readonly AdminSection[]; label: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" role="list" aria-label={label}>
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <Link
            key={section.href}
            href={section.href}
            role="listitem"
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
                  <h3 className="text-lg font-bold tracking-tight">{section.title}</h3>
                  <ChevronRight
                    className="ms-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
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
  );
}
