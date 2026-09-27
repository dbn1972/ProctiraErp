'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { themeDecisionAction } from '../actions';

/**
 * Reject uses a second step. Admin-console cannot import the web
 * ConfirmActionDialog, so this dialog keeps the same test id contract
 * (`theme-reject-confirm` / `theme-reject-cancel`).
 */
export function ThemeDecisionForm({ themeId }: { themeId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  function requestReject() {
    const reason = String(new FormData(formRef.current ?? undefined).get('reason') ?? '').trim();
    if (reason.length < 10) {
      setNotesError('Enter reviewer notes of at least 10 characters before rejecting.');
      return;
    }
    setNotesError(null);
    setOpen(true);
  }

  return (
    <form ref={formRef} action={themeDecisionAction} className="space-y-3">
      <input type="hidden" name="id" value={themeId} />
      <div className="space-y-1.5">
        <Label htmlFor="reviewer-notes">Reviewer notes</Label>
        <Textarea
          id="reviewer-notes"
          name="reason"
          required
          minLength={10}
          aria-label="Reviewer notes"
          placeholder="What did you check before this decision?"
        />
        {notesError ? (
          <p className="text-xs text-destructive" role="alert">
            {notesError}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" name="action" value="approve">
          Approve
        </Button>
        <Button type="button" variant="destructive" onClick={requestReject}>
          Reject
        </Button>
      </div>
      <button
        ref={rejectRef}
        type="submit"
        name="action"
        value="reject"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="theme-reject">
          <DialogHeader>
            <DialogTitle>Reject this theme?</DialogTitle>
            <DialogDescription>
              The theme stays out of the marketplace. Reviewer notes are stored with the decision.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              data-testid="theme-reject-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => rejectRef.current?.click()}
              data-testid="theme-reject-confirm"
            >
              Reject theme
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
