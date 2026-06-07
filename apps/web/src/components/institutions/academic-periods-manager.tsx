'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import {
  Badge,
  Button,
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
import { AcademicPeriodFormDialog } from './academic-period-form-dialog';
import { deleteAcademicPeriodAction } from '@/lib/institutions/actions';
import type { AcademicPeriod } from '@/lib/institutions/types';

export interface AcademicPeriodsManagerProps {
  periods: AcademicPeriod[];
  loadError?: string | null;
}

export function AcademicPeriodsManager({
  periods,
  loadError,
}: AcademicPeriodsManagerProps) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    initial?: AcademicPeriod;
  }>({ open: false });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = (period: AcademicPeriod) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Delete academic period "${period.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteAcademicPeriodAction(period.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Academic periods</CardTitle>
        <Button
          size="sm"
          onClick={() => setDialogState({ open: true })}
          disabled={isPending}
        >
          <Plus className="h-4 w-4" /> New period
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {(error || loadError) && (
          <div
            role="alert"
            className="mx-6 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error ?? loadError}
          </div>
        )}

        {periods.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No academic periods have been defined yet. Create one to enable
            enrollment, attendance, and assessments for the school year.
          </p>
        ) : (
          <Table aria-label="Academic periods">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <TableRow key={period.id}>
                  <TableCell className="font-medium">{period.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {period.code}
                    </code>
                  </TableCell>
                  <TableCell>{period.startDate}</TableCell>
                  <TableCell>{period.endDate}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        period.status === 'active'
                          ? 'success'
                          : period.status === 'archived'
                            ? 'outline'
                            : 'secondary'
                      }
                    >
                      {period.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialogState({ open: true, initial: period })}
                      disabled={isPending}
                      aria-label={`Edit ${period.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(period)}
                      disabled={isPending || period.status === 'active'}
                      aria-label={`Delete ${period.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AcademicPeriodFormDialog
        open={dialogState.open}
        onOpenChange={(open) =>
          setDialogState((prev) => ({ open, initial: open ? prev.initial : undefined }))
        }
        initialValue={dialogState.initial}
      />
    </Card>
  );
}
