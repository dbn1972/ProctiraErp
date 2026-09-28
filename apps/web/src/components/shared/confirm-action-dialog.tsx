'use client';

/**
 * Shared confirmation for irreversible or money-moving actions (UX_FINDINGS W1).
 * Callers open this before the server action so a mis-tap cannot publish, pay,
 * approve, or decline without an explicit second step.
 */
import type { ReactNode } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@proctira/ui/components';

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Primary button label. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the destructive variant. */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  /** Optional test id prefix; buttons get `${testId}-confirm` / `${testId}-cancel`. */
  testId?: string;
  /** Extra fields (for example a required reason) rendered above the actions. */
  children?: ReactNode;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onConfirm,
  testId = 'confirm-action',
  children,
}: ConfirmActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testId} data-hydrated="true">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            data-testid={`${testId}-cancel`}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={onConfirm}
            data-testid={`${testId}-confirm`}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
