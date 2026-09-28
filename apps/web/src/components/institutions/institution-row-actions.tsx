'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, MoreVertical, Pencil } from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Textarea,
} from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { deactivateInstitutionAction } from '@/lib/institutions/actions';

const iconButtonClass =
  'h-8 w-8 min-h-6 min-w-6 p-0 focus-visible:ring-2 focus-visible:ring-ring';

export function InstitutionRowActions({
  id,
  name,
  status,
}: {
  id: string;
  name: string;
  status: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canDeactivate = status === 'ACTIVE';

  const deactivate = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A deactivation reason is required');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deactivateInstitutionAction(id, trimmed);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      setReason('');
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button asChild variant="ghost" size="icon" className={iconButtonClass}>
        <Link href={`/institutions/${id}`} aria-label={`View ${name}`}>
          <Eye className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
      <Button asChild variant="ghost" size="icon" className={iconButtonClass}>
        <Link href={`/institutions/${id}/edit`} aria-label={`Edit ${name}`}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconButtonClass}
            aria-label={`More actions for ${name}`}
            data-testid={`institution-more-${id}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/institutions/${id}`}>View school</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/institutions/${id}/edit`}>Edit school</Link>
          </DropdownMenuItem>
          {canDeactivate ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
            >
              Deactivate school
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Deactivate ${name}?`}
        description="The school is marked inactive. Student, staff, and attendance figures on this row are hidden."
        confirmLabel="Deactivate"
        destructive
        pending={pending}
        onConfirm={deactivate}
        testId={`deactivate-${id}`}
      >
        <div className="space-y-2">
          <Label htmlFor={`deactivate-reason-${id}`}>Reason</Label>
          <Textarea
            id={`deactivate-reason-${id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            placeholder="Why is this school being deactivated?"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </ConfirmActionDialog>
    </div>
  );
}
