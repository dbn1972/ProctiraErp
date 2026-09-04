'use client';

/**
 * Invite user dialog for /admin/users.
 *
 * POST /admin/users/invite (via inviteUser helper).
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@proctira/ui/components';
import { inviteUser } from '@/lib/api/admin';

export function InviteUserButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await inviteUser({
          email: trimmedEmail,
          displayName: displayName.trim() || undefined,
        });
        setOpen(false);
        setEmail('');
        setDisplayName('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send invite');
      }
    });
  }

  return (
    <>
      <Button size="sm" type="button" onClick={() => setOpen(true)}>
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Invite user
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              Send an invitation to join this tenant. They will appear as Invited until accepted.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@example.gov.in"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Display name</Label>
              <Input
                id="invite-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !email.trim()}>
                {isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
