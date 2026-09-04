'use client';

/**
 * Create role dialog for /admin/roles.
 *
 * Uses the existing client admin API (`createRole` → POST /tenant/roles).
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
import { createRole } from '@/lib/api/admin';

export function CreateRoleButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Role name is required');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createRole({
          name: trimmed,
          description: description.trim() || null,
          permissions: [],
        });
        setOpen(false);
        setName('');
        setDescription('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create role');
      }
    });
  }

  return (
    <>
      <Button size="sm" type="button" onClick={() => setOpen(true)}>
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Create role
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Add a custom role, then assign permissions from the matrix.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="District officer"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Input
                id="role-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create role
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
