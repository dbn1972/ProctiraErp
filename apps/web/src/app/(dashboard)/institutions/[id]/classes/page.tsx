/**
 * Classes tab — Server Component.
 *
 * Lists the class sections defined for an institution, grouped by grade.
 * Sections are scoped to an academic period (Requirement 5.5).
 */
import { Users } from 'lucide-react';

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
import {
  ApiClientError,
  listClassesByInstitution,
  listGrades,
} from '@/lib/institutions/api';
import type { ClassSection, Grade } from '@/lib/institutions/types';

interface ClassesPageProps {
  params: { id: string };
}

interface ClassesData {
  classes: ClassSection[];
  grades: Grade[];
  error: string | null;
}

export default async function InstitutionClassesPage({ params }: ClassesPageProps) {
  const data = await loadClasses(params.id);
  const gradeMap = new Map(data.grades.map((grade) => [grade.id, grade]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Class sections</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.error ? 'Service unavailable' : `${data.classes.length} sections`}
        </p>
      </CardHeader>
      <CardContent className="px-0">
        {data.error ? (
          <p className="px-6 text-sm text-muted-foreground">{data.error}</p>
        ) : data.classes.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No class sections have been created for this institution yet.
          </p>
        ) : (
          <Table aria-label="Class sections">
            <TableHeader>
              <TableRow>
                <TableHead>Grade</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Academic period</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.classes.map((classSection) => {
                const grade = gradeMap.get(classSection.gradeId);
                return (
                  <TableRow key={classSection.id}>
                    <TableCell className="font-medium">
                      {grade ? `${grade.name} (${grade.code})` : '—'}
                    </TableCell>
                    <TableCell>{classSection.name}</TableCell>
                    <TableCell>
                      {classSection.capacity !== null
                        ? classSection.capacity.toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {classSection.academicPeriodId}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function loadClasses(institutionId: string): Promise<ClassesData> {
  try {
    const [classes, grades] = await Promise.all([
      listClassesByInstitution(institutionId),
      listGrades().catch(() => [] as Grade[]),
    ]);
    return { classes, grades, error: null };
  } catch (error) {
    return {
      classes: [],
      grades: [],
      error:
        error instanceof ApiClientError
          ? error.message
          : 'The class catalog is currently unavailable.',
    };
  }
}
