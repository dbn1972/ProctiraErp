'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import type { BreakGlassStatus } from '@/lib/api/break-glass';

import { breakGlassDecisionAction } from '../actions';

interface ApprovalActionsProps {
  id: string;
  status: BreakGlassStatus;
}

export function ApprovalActions({ id, status }: ApprovalActionsProps) {
  if (status === 'pending_approval') {
    return (
      <div className="flex gap-2">
        <DecisionDialog
          id={id}
          decision="approve"
          label="Approve"
          tone="default"
          title="Approve break-glass request"
          description="Granting elevated access. Add a justification — recorded with your operator identity."
        />
        <DecisionDialog
          id={id}
          decision="deny"
          label="Deny"
          tone="outline"
          title="Deny break-glass request"
          description="The requester will be notified. Reason will be visible to them."
        />
      </div>
    );
  }
  if (status === 'active' || status === 'approved') {
    return (
      <DecisionDialog
        id={id}
        decision="revoke"
        label="Revoke"
        tone="destructive"
        title="Revoke active grant"
        description="The session is terminated immediately. The action is audited."
      />
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function DecisionDialog({
  id,
  decision,
  label,
  tone,
  title,
  description,
}: {
  id: string;
  decision: 'approve' | 'deny' | 'revoke';
  label: string;
  tone: 'default' | 'destructive' | 'outline';
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={tone}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          action={async (formData) => {
            await breakGlassDecisionAction(formData);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value={decision} />
          <Textarea
            name="reason"
            required
            minLength={10}
            placeholder="Reason / justification (audited)"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={tone}>
              Confirm {decision}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
