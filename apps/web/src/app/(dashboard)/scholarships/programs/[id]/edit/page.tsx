/**
 * Edit scholarship program page.
 *
 * Cite: redesign/web/scholarships-program-new.html (edit variant)
 * Wires PUT /scholarships/programs/:id via EditProgramForm.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getScholarshipProgram } from '@/lib/api/scholarships';

import { EditProgramForm } from '../../../_components/edit-program-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function EditScholarshipProgramPage({ params }: PageProps) {
  const program = await getScholarshipProgram(params.id);
  if (!program) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href={`/scholarships/programs/${program.id}`}>
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to program
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          Edit program
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update award details and the application window for {program.name}.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Program details</CardTitle>
          <CardDescription>
            Changes apply immediately to new applications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditProgramForm program={program} />
        </CardContent>
      </Card>
    </div>
  );
}
