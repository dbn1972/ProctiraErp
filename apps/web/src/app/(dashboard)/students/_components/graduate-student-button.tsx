'use client';

import { useState, useTransition } from 'react';
import { GraduationCap } from 'lucide-react';
import { Button } from '@proctira/ui/components';
import { graduateEnrollmentAction } from '../actions';

export function GraduateStudentButton({
  studentId,
  enrollmentId,
}: {
  studentId: string;
  enrollmentId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        data-testid="graduate-student"
        onClick={() => {
          if (
            !window.confirm(
              'Graduate this student? Their current enrollment will be marked GRADUATED.',
            )
          ) {
            return;
          }
          setMessage(null);
          startTransition(async () => {
            const result = await graduateEnrollmentAction(studentId, enrollmentId);
            setMessage(result.message ?? (result.status === 'success' ? 'Graduated.' : 'Failed.'));
          });
        }}
      >
        <GraduationCap className="me-1.5 h-4 w-4" aria-hidden="true" />
        {pending ? 'Graduating…' : 'Graduate'}
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
