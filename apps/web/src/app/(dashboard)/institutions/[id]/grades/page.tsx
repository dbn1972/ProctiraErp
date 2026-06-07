/**
 * Grades tab — Server Component.
 *
 * Lists the education grade levels offered by an institution. Grades are a
 * tenant-wide catalog managed centrally; this view shows the catalog for
 * reference and for use when creating class sections.
 */
import { GraduationCap } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { ApiClientError, listGrades } from '@/lib/institutions/api';
import type { Grade } from '@/lib/institutions/types';

export default async function InstitutionGradesPage() {
  const result = await loadGrades();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <GraduationCap
            className="h-5 w-5 text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle className="text-base">Grades offered</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          {result.error ? 'Catalog unavailable' : `${result.grades.length} grades`}
        </p>
      </CardHeader>
      <CardContent className="px-0">
        {result.error ? (
          <p className="px-6 text-sm text-muted-foreground">{result.error}</p>
        ) : result.grades.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No grades have been defined for this tenant yet.
          </p>
        ) : (
          <Table aria-label="Grades">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.grades.map((grade) => (
                <TableRow key={grade.id}>
                  <TableCell className="w-16 text-muted-foreground">
                    {grade.order}
                  </TableCell>
                  <TableCell className="font-medium">{grade.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {grade.code}
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function loadGrades(): Promise<
  { grades: Grade[]; error: null } | { grades: never[]; error: string }
> {
  try {
    const grades = await listGrades();
    return { grades: grades.sort((a, b) => a.order - b.order), error: null };
  } catch (error) {
    return {
      grades: [],
      error:
        error instanceof ApiClientError
          ? error.message
          : 'The grade catalog is currently unavailable.',
    };
  }
}
