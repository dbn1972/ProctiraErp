/**
 * Institution detail layout (Server Component).
 *
 * Wraps each detail tab (overview, grades, classes, infrastructure) with a
 * shared header (institution name, status, actions) and tab navigation.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, Pencil } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { InstitutionTabs } from '@/components/institutions/institution-tabs';
import { ApiClientError, getInstitution } from '@/lib/institutions/api';

interface InstitutionLayoutProps {
  params: { id: string };
  children: React.ReactNode;
}

export default async function InstitutionLayout({
  params,
  children,
}: InstitutionLayoutProps) {
  const institution = await loadInstitution(params.id);

  if (!institution) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Building2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-xl">{institution.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Code <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {institution.code}
                  </code>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={institution.status === 'ACTIVE' ? 'success' : 'secondary'}
              >
                {institution.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </Badge>
              <Button asChild variant="outline" size="sm">
                <Link href={`/institutions/${institution.id}/edit`}>
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="border-t pt-4">
          <InstitutionTabs institutionId={institution.id} />
        </CardContent>
      </Card>

      {children}
    </div>
  );
}

async function loadInstitution(id: string) {
  try {
    return await getInstitution(id);
  } catch (error) {
    if (error instanceof ApiClientError && error.statusCode === 404) {
      return null;
    }
    // Re-throw other errors so Next.js can show the error boundary.
    throw error;
  }
}
