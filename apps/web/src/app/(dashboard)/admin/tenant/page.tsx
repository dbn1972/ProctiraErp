/**
 * Admin tenant configuration page.
 *
 * Validates: Requirement 4.x — configure tenant identity, locales, branding.
 */
import {
  Badge,
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

export const dynamic = 'force-dynamic';

export default async function TenantConfigPage() {
  const config = await getTenantConfig();

  return (
    <section aria-labelledby="tenant-heading" className="space-y-6">
      <header>
        <h1 id="tenant-heading" className="text-2xl font-semibold tracking-tight">
          Tenant configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Update display name, locales, branding, and contact details.
        </p>
      </header>

      {config ? (
        <form className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identity</CardTitle>
              <CardDescription>
                Tenant ID <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{config.tenantId}</code>
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
                    <Badge key={locale} variant="outline">
                      {locale}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
              <CardDescription>Public contact details surfaced in support flows.</CardDescription>
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

          <div className="flex items-end justify-end lg:col-span-2">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      ) : (
        <Card>
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
