'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn } from '@/lib/auth';

/** Platform admin login form. */
export function LoginForm() {
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get('returnTo') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await signIn(email, password);
    if (result.success) {
      window.location.href = returnTo;
      return;
    }
    setError(result.message ?? 'Authentication failed.');
    setSubmitting(false);
  }

  return (
    <Card className="w-full max-w-md border-none shadow-none lg:shadow-sm">
      <CardContent className="p-8">
        <header className="mb-6 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">
            Sign in
          </h1>
          <p className="text-sm text-muted-foreground">
            Use your platform-admin credentials. Tenant accounts cannot sign in
            here.
          </p>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={submitting}
              placeholder="ops@proctira.org"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && (
              <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Having trouble? Contact the security team via the on-call rotation.
        </p>
      </CardContent>
    </Card>
  );
}
