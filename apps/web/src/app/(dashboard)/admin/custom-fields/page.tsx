/**
 * Admin custom fields list (Server Component).
 *
 * Layout per redesign/web/admin-custom-fields.html:
 *  - Page head with New field CTA
 *  - Entity-type tabs (Students / Staff / Institutions)
 *  - Warning alert about deactivation
 *  - Fields table for the selected entity
 *
 * Validates: Requirements 6.5 / 7.6 — extend profiles without schema changes.
 */
import Link from 'next/link';
import { AlertTriangle, FormInput, Plus } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listCustomFieldDefinitions,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
} from '@/lib/api/custom-fields';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ENTITY_TABS: Array<{ key: CustomFieldEntityType; label: string }> = [
  { key: 'student', label: 'Students' },
  { key: 'staff', label: 'Staff' },
  { key: 'institution', label: 'Institutions' },
];

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Select',
  checkbox: 'Checkbox',
  textarea: 'Textarea',
  file: 'File',
};

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveEntity(
  raw: string | undefined,
): CustomFieldEntityType {
  if (raw === 'staff' || raw === 'institution' || raw === 'student') return raw;
  return 'student';
}

export default async function AdminCustomFieldsPage({ searchParams }: PageProps) {
  const entityType = resolveEntity(single(searchParams?.entity));
  const fields = await listCustomFieldDefinitions({ entityType, pageSize: 100 });

  // Counts for tab badges — fetch lightly in parallel for all entity types.
  const [studentFields, staffFields, institutionFields] = await Promise.all([
    entityType === 'student'
      ? Promise.resolve(fields)
      : listCustomFieldDefinitions({ entityType: 'student', pageSize: 100 }),
    entityType === 'staff'
      ? Promise.resolve(fields)
      : listCustomFieldDefinitions({ entityType: 'staff', pageSize: 100 }),
    entityType === 'institution'
      ? Promise.resolve(fields)
      : listCustomFieldDefinitions({ entityType: 'institution', pageSize: 100 }),
  ]);

  const counts: Record<CustomFieldEntityType, number> = {
    student: studentFields.length,
    staff: staffFields.length,
    institution: institutionFields.length,
  };

  return (
    <section aria-labelledby="custom-fields-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="custom-fields-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Custom fields
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Extend student, staff and institution records with district-specific
            data points · keys are stable across API and exports.
          </p>
        </div>
        <Button size="sm" type="button" disabled>
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
          New field
        </Button>
      </div>

      <div
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Entity type"
      >
        {ENTITY_TABS.map((tab) => {
          const active = tab.key === entityType;
          return (
            <Link
              key={tab.key}
              href={`/admin/custom-fields?entity=${tab.key}`}
              role="tab"
              aria-selected={active}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
                {counts[tab.key].toLocaleString()}
              </span>
            </Link>
          );
        })}
      </div>

      <Alert variant="warning">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Deactivating a field never deletes data</AlertTitle>
        <AlertDescription>
          Existing values stay on records and in exports; the field simply stops
          appearing on new forms. Reactivate any time to resume collection.
        </AlertDescription>
      </Alert>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {fields.length === 0 ? (
            <EmptyState entityType={entityType} />
          ) : (
            <Table aria-label={`${entityType} custom fields`}>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Field</TableHead>
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="font-semibold">Required</TableHead>
                  <TableHead className="font-semibold">Order</TableHead>
                  <TableHead className="font-semibold">Active</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...fields]
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((field) => (
                    <FieldRow key={field.id} field={field} />
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState({ entityType }: { entityType: CustomFieldEntityType }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <FormInput className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No custom fields for {entityType}</p>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        Definitions appear here when the custom-field service is available.
        Fields extend forms and exports without schema migrations.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link href="/admin">Back to administration</Link>
      </Button>
    </div>
  );
}

function FieldRow({ field }: { field: CustomFieldDefinition }) {
  const required = Boolean(field.validationRules?.required);
  return (
    <TableRow className="group">
      <TableCell>
        <div className="font-semibold text-foreground">{field.label}</div>
        <p className="font-mono text-xs text-muted-foreground">
          {field.entityType}.{field.fieldKey}
        </p>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
          {TYPE_LABELS[field.fieldType] ?? field.fieldType}
        </span>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold',
            required
              ? 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {required ? 'Required' : 'Optional'}
        </span>
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {field.displayOrder}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full px-0.5 transition-colors',
            field.isActive ? 'bg-emerald-500/90' : 'bg-zinc-300 dark:bg-zinc-700',
          )}
          role="switch"
          aria-checked={field.isActive}
          aria-label={field.isActive ? 'Active' : 'Inactive'}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-white shadow transition-transform',
              field.isActive ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </TableCell>
      <TableCell className="text-end">
        <Button
          variant="ghost"
          size="sm"
          className="opacity-60 group-hover:opacity-100"
          type="button"
          disabled
        >
          Edit
        </Button>
      </TableCell>
    </TableRow>
  );
}
