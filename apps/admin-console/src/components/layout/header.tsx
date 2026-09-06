'use client';

import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { signOut, type PlatformRole, PLATFORM_ROLE_LABELS } from '@/lib/auth';

interface HeaderProps {
  email: string;
  role?: PlatformRole;
}

/** Top header of the admin shell — shows operator identity and role. */
export function Header({ email, role }: HeaderProps) {
  const roleLabel = role ? PLATFORM_ROLE_LABELS[role] : 'Operator';

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-[hsl(var(--card))] px-6">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Platform Admin Console
        </p>
        <Badge variant="info" className="ml-2">
          {roleLabel}
        </Badge>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-foreground">{email}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => signOut('/login')}
        >
          <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
