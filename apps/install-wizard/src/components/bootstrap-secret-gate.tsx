'use client';

import { useId, useState, type FormEvent } from 'react';

import { StepCard } from '@/components/step-card';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/lib/design-system';

interface BootstrapSecretGateProps {
  onUnlocked: () => void;
}

/**
 * PRC-M467: the operator proves possession of the installer bootstrap secret (issued by the
 * secret manager) before any install session exists.
 */
export function BootstrapSecretGate({ onUnlocked }: BootstrapSecretGateProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!secret.trim()) {
      setError('Enter the bootstrap secret.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.startSession(secret.trim());
      setSecret('');
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start the install session.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StepCard
      title="Operator verification"
      description="Enter the installer bootstrap secret from your secret manager to start the setup."
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
        <div>
          <label htmlFor={inputId} className="label">
            Bootstrap secret
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="input-field"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            required
          />
          <p id={hintId} className="mt-1 text-xs text-gray-500">
            The value of INSTALL_BOOTSTRAP_SECRET. It is sent once and not stored in the browser.
          </p>
          {error && (
            <p id={errorId} role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Start setup'}
        </Button>
      </form>
    </StepCard>
  );
}
