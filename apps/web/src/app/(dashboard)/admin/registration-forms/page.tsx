/**
 * /admin/registration-forms — Manage FormConfiguration for the public portal.
 *
 * v2.0 redesign + admin custom-fields patterns. Wires
 * GET /api/v1/registrations/form-configs and PUT /form-config.
 * Public portal already consumes GET /form-config/:institutionId.
 */
import Link from 'next/link';
import { ArrowLeft, ClipboardList } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listFormConfigurations } from '@/lib/api/form-configurations';

import { FormConfigEditor } from './_components/form-config-editor';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStr(
  params: PageProps['searchParams'],
  key: string,
  fallback = '',
): string {
  if (!params) return fallback;
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? fallback;
  return fallback;
}

export default async function RegistrationFormsAdminPage({
  searchParams,
}: PageProps) {
  const selectedTypeId = readStr(searchParams, 'typeId');
  const configs = await listFormConfigurations();
  const selected =
    configs.find((c) => c.institutionTypeId === selectedTypeId) ?? null;

  return (
    <section aria-labelledby="registration-forms-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/admin">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Administration
        </Link>
      </Button>

      <div>
        <h1
          id="registration-forms-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Registration forms
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure custom fields per institution type for the public
          registration portal ·{' '}
          {configs.length.toLocaleString()} configuration
          {configs.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configurations</CardTitle>
            <CardDescription>
              Consumed by the registration portal via{' '}
              <code className="text-xs">/registrations/form-config/:id</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {configs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <ClipboardList
                  className="h-10 w-10 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-base font-semibold">No form configs yet</p>
                <p className="text-sm text-muted-foreground">
                  Upsert a configuration to extend the public application form.
                </p>
              </div>
            ) : (
              <Table aria-label="Form configurations">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold">
                      Institution type
                    </TableHead>
                    <TableHead className="text-end font-semibold">
                      Fields
                    </TableHead>
                    <TableHead className="text-end font-semibold">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map((config) => (
                    <TableRow key={config.institutionTypeId}>
                      <TableCell>
                        <p className="font-mono text-sm text-foreground">
                          {config.institutionTypeId}
                        </p>
                      </TableCell>
                      <TableCell className="text-end text-sm tabular-nums">
                        {config.fields.length}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`/admin/registration-forms?typeId=${encodeURIComponent(config.institutionTypeId)}`}
                          >
                            Edit
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected ? 'Edit configuration' : 'Upsert configuration'}
            </CardTitle>
            <CardDescription>
              Save replaces the field list for that institution type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormConfigEditor
              key={selected?.institutionTypeId ?? 'new'}
              initial={selected}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
