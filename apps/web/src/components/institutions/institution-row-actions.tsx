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
import {
  deactivateInstitutionAction,
  reactivateInstitutionAction,
} from '@/lib/institutions/actions';

const iconButtonClass = 'h-8 w-8 min-h-6 min-w-6 p-0 focus-visible:ring-2 focus-visible:ring-ring';

function StatusToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      data-testid="institution-status-toast"
      className="fixed bottom-4 end-4 z-50 max-w-sm rounded-md border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg"
    >
      {message}
    </p>
  );
}

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
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reactivateReason, setReactivateReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canDeactivate = status === 'ACTIVE';
  const canReactivate = status === 'INACTIVE';

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
      setToast(`${name} is inactive`);
      router.refresh();
    });
  };

  const reactivate = () => {
    const trimmed = reactivateReason.trim();
    if (!trimmed) {
      setReactivateError('A reactivation reason is required');
      return;
    }
    setReactivateError(null);
    startTransition(async () => {
      const result = await reactivateInstitutionAction(id, trimmed);
      if (!result.success) {
        setReactivateError(result.error);
        return;
      }
      setReactivateOpen(false);
      setReactivateReason('');
      setToast(`${name} is active again`);
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
          {canReactivate ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setMenuOpen(false);
                setReactivateOpen(true);
              }}
            >
              Reactivate
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

      <ConfirmActionDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title={`Reactivate ${name}?`}
        description="The school is marked active. New enrollments are allowed again, and student, staff, and attendance figures return on this list."
        confirmLabel="Reactivate"
        pending={pending}
        onConfirm={reactivate}
        testId={`reactivate-${id}`}
      >
        <div className="space-y-2">
          <Label htmlFor={`reactivate-reason-${id}`}>Reason</Label>
          <Textarea
            id={`reactivate-reason-${id}`}
            value={reactivateReason}
            onChange={(event) => setReactivateReason(event.target.value)}
            required
            rows={3}
            placeholder="Why is this school being reactivated?"
          />
          {reactivateError ? <p className="text-sm text-destructive">{reactivateError}</p> : null}
        </div>
      </ConfirmActionDialog>
      <StatusToast message={toast} />
    </div>
  );
}

/** Edit-form control. Deactivate stays off the hero while the profile form is open. */
export function InstitutionDeactivateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      setOpen(false);
      setReason('');
      setToast(`${name} is inactive`);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid={`deactivate-form-${id}`}
      >
        Deactivate school
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Deactivate ${name}?`}
        description="The school is marked inactive. You can reactivate it from this form later."
        confirmLabel="Deactivate"
        destructive
        pending={pending}
        onConfirm={deactivate}
        testId={`deactivate-form-dialog-${id}`}
      >
        <div className="space-y-2">
          <Label htmlFor={`deactivate-form-reason-${id}`}>Reason</Label>
          <Textarea
            id={`deactivate-form-reason-${id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            placeholder="Why is this school being deactivated?"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </ConfirmActionDialog>
      <StatusToast message={toast} />
    </>
  );
}

/** Detail header control for an inactive school. Deactivate stays on the list menu.
 *  The component stays mounted after refresh so the success toast is not removed
 *  when the server stops rendering the button. */
export function InstitutionReactivateButton({
  id,
  name,
  inactive = true,
}: {
  id: string;
  name: string;
  inactive?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reactivate = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A reactivation reason is required');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reactivateInstitutionAction(id, trimmed);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason('');
      setToast(`${name} is active again`);
      router.refresh();
    });
  };

  return (
    <>
      {inactive ? (
        <Button
          type="button"
          size="sm"
          className="!h-8 !min-h-8 !min-w-0 !gap-1.5 !px-2.5 !text-xs"
          onClick={() => setOpen(true)}
          data-testid={`reactivate-header-${id}`}
        >
          Reactivate
        </Button>
      ) : null}
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Reactivate ${name}?`}
        description="The school is marked active. New enrollments are allowed again."
        confirmLabel="Reactivate"
        pending={pending}
        onConfirm={reactivate}
        testId={`reactivate-header-dialog-${id}`}
      >
        <div className="space-y-2">
          <Label htmlFor={`reactivate-header-reason-${id}`}>Reason</Label>
          <Textarea
            id={`reactivate-header-reason-${id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            placeholder="Why is this school being reactivated?"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </ConfirmActionDialog>
      <StatusToast message={toast} />
    </>
  );
}
