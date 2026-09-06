/**
 * Admin tenant configuration page.
 *
 * Validates: Requirement 4.x — configure tenant identity, locales, branding.
 */
import { Check } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { getTenantConfig } from '@/lib/api/admin.server';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

export const dynamic = 'force-dynamic';

export default async function TenantConfigPage() {
  const config = await getTenantConfig();

  return (
    <section aria-labelledby="tenant-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="tenant-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Tenant settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update display name, locales, branding, and contact details.
          </p>
        </div>
        {config ? (
          <Button type="submit" form="tenant-config-form" size="sm">
            <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
            Save changes
          </Button>
        ) : null}
      </div>

      <ScaffoldModeBanner
        surface="Admin tenant"
        detail="Nested admin UI scaffold. Settings form stays empty when tenant admin APIs are offline."
      />

      {config ? (
        <form id="tenant-config-form" className="space-y-6">
          <Card className="max-w-[860px]">
            <CardHeader>
              <CardTitle className="text-base">Identity</CardTitle>
              <CardDescription>
                Tenant ID{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {config.tenantId}
                </code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="tenant-name" label="Display name" required>
                <Input id="tenant-name" name="displayName" defaultValue={config.displayName} />
              </FormField>
              <FormField id="tenant-default-locale" label="Default locale" required>
                <Input
                  id="tenant-default-locale"
                  name="defaultLocale"
                  defaultValue={config.defaultLocale}
                  placeholder="en"
                />
              </FormField>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Supported locales</p>
                <div className="flex flex-wrap gap-2">
                  {config.supportedLocales.map((locale) => (
                    <span
                      key={locale}
                      className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {locale}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-[860px]">
            <CardHeader>
              <CardTitle className="text-base">Branding</CardTitle>
              <CardDescription>Customise theme colours and logo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="tenant-primary" label="Primary colour" required>
                <Input
                  id="tenant-primary"
                  name="primaryColor"
                  defaultValue={config.branding.primaryColor}
                  placeholder="#1E3A8A"
                />
              </FormField>
              <FormField id="tenant-accent" label="Accent colour" required>
                <Input
                  id="tenant-accent"
                  name="accentColor"
                  defaultValue={config.branding.accentColor}
                  placeholder="#26A69A"
                />
              </FormField>
              <FormField id="tenant-logo" label="Logo URL">
                <Input
                  id="tenant-logo"
                  name="logoUrl"
                  type="url"
                  defaultValue={config.branding.logoUrl ?? ''}
                  placeholder="https://example.com/logo.svg"
                />
              </FormField>
            </CardContent>
          </Card>

          <Card className="max-w-[860px]">
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
              <CardDescription>
                Public contact details surfaced in support flows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="tenant-email" label="Email">
                <Input
                  id="tenant-email"
                  name="contactEmail"
                  type="email"
                  defaultValue={config.contact.email ?? ''}
                />
              </FormField>
              <FormField id="tenant-phone" label="Phone">
                <Input
                  id="tenant-phone"
                  name="contactPhone"
                  defaultValue={config.contact.phone ?? ''}
                />
              </FormField>
            </CardContent>
          </Card>

          <div className="flex max-w-[860px] justify-end">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      ) : (
        <Card className="max-w-[860px]">
          <CardHeader>
            <CardTitle className="text-base">Tenant config unavailable</CardTitle>
            <CardDescription>
              The tenant configuration service is unreachable. Check back shortly.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </section>
  );
}
