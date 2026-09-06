'use client';

import { useState, type FormEvent } from 'react';

const SCOPES = ['students:read', 'attendance:write', 'webhooks:manage'] as const;

/**
 * Client-only API key request demo.
 * Validates input locally and acknowledges that live issuance is not connected.
 */
export function ApiKeyDemoForm() {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('students:read');
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAck(null);
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setError('Key name must be at least 3 characters.');
      return;
    }
    setError(null);
    setAck(
      `Demo only — "${trimmed}" with scope ${scope} was validated locally. Live key issuance is not connected.`,
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 max-w-lg space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="api-key-demo-form"
      noValidate
    >
      <div>
        <label htmlFor="api-key-name" className="block text-sm font-medium text-gray-800">
          Key name
        </label>
        <input
          id="api-key-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="Attendance sync"
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="api-key-scope" className="block text-sm font-medium text-gray-800">
          Scope
        </label>
        <select
          id="api-key-scope"
          name="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          {SCOPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert" data-testid="api-key-demo-error">
          {error}
        </p>
      ) : null}
      {ack ? (
        <p
          className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
          data-testid="api-key-demo-ack"
        >
          {ack}
        </p>
      ) : null}

      <button
        type="submit"
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        data-testid="api-key-demo-submit"
      >
        Validate key request
      </button>
    </form>
  );
}
