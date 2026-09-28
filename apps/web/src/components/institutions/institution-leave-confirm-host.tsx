'use client';

import { useEffect, useState } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@proctira/ui/components';
import {
  LEAVE_CONFIRM_EVENT,
  resolveLeaveConfirm,
} from '@/components/institutions/institution-unsaved-guard';

/**
 * In-app leave confirmation for institution profile forms. Mount once under the
 * institution detail layout so Back / Cancel / nav links share the same dialog.
 */
export function InstitutionLeaveConfirmHost() {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const onRequest = () => setOpen(true);
    window.addEventListener(LEAVE_CONFIRM_EVENT, onRequest);
    setListening(true);
    return () => {
      window.removeEventListener(LEAVE_CONFIRM_EVENT, onRequest);
      setListening(false);
    };
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolveLeaveConfirm(ok);
  };

  return (
    <>
      <span data-testid="institution-leave-guard-ready" data-ready={listening ? 'true' : 'false'} />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) finish(false);
        }}
      >
        <DialogContent
          role="alertdialog"
          aria-labelledby="institution-leave-title"
          aria-describedby="institution-leave-description"
          data-testid="institution-leave-confirm"
          className="max-w-md"
        >
          <DialogHeader>
            <DialogTitle id="institution-leave-title">Unsaved changes</DialogTitle>
            <DialogDescription id="institution-leave-description">
              You have unsaved changes. Leave without saving?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="institution-leave-stay"
              onClick={() => finish(false)}
            >
              Stay
            </Button>
            <Button
              type="button"
              data-testid="institution-leave-leave"
              onClick={() => finish(true)}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
