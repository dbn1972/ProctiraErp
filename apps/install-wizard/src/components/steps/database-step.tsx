'use client';

import { useState } from 'react';
import { StepCard } from '@/components/step-card';
import { StatusMessage } from '@/components/status-message';
import { apiClient, type DatabaseConfig, type ValidationResult } from '@/lib/api-client';
import {
  validateDatabaseConfig,
  type DatabaseFieldErrors,
} from '@/lib/database-validation';

interface DatabaseStepProps {
  onComplete: () => void;
}

export function DatabaseStep({ onComplete }: DatabaseStepProps) {
  const [config, setConfig] = useState<DatabaseConfig>({
    provider: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'proctira',
    username: '',
    password: '',
    ssl: false,
    poolSize: 10,
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DatabaseFieldErrors>({});

  const handleProviderChange = (provider: 'postgresql' | 'mysql') => {
    setConfig((prev) => ({
      ...prev,
      provider,
      port: provider === 'postgresql' ? 5432 : 3306,
    }));
    setResult(null);
    setFieldErrors({});
  };

  const handleTest = async () => {
    const errors = validateDatabaseConfig(config);
    setFieldErrors(errors ?? {});
    if (errors) {
      setResult({
        success: false,
        step: 'database',
        message: 'Validation failed',
        error: 'Fix the highlighted fields before testing the connection.',
      });
      return;
    }

    setTesting(true);
    setResult(null);
    try {
      const response = await apiClient.configureDatabase(config);
      setResult(response);
      if (response.success) {
        setTimeout(onComplete, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        step: 'database',
        message: 'Connection failed',
        error: err instanceof Error ? err.message : 'Unable to reach the install service. Ensure the backend is running.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <StepCard
      title="Step 1: Database Configuration"
      description="Select your database provider and configure the connection. The wizard will test connectivity before proceeding."
    >
      <div className="space-y-4" data-testid="database-step">
        <fieldset>
          <legend className="label">Database Provider</legend>
          <div className="mt-2 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
              <input
                type="radio"
                name="provider"
                value="postgresql"
                checked={config.provider === 'postgresql'}
                onChange={() => handleProviderChange('postgresql')}
                className="text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm font-medium">PostgreSQL</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
              <input
                type="radio"
                name="provider"
                value="mysql"
                checked={config.provider === 'mysql'}
                onChange={() => handleProviderChange('mysql')}
                className="text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm font-medium">MySQL</span>
            </label>
          </div>
          {fieldErrors.provider ? (
            <p className="error-text" data-testid="db-error-provider">{fieldErrors.provider}</p>
          ) : null}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="db-host" className="label">Host</label>
            <input
              id="db-host"
              type="text"
              className="input-field"
              value={config.host}
              onChange={(e) => setConfig((prev) => ({ ...prev, host: e.target.value }))}
              placeholder="localhost"
            />
            {fieldErrors.host ? (
              <p className="error-text" data-testid="db-error-host">{fieldErrors.host}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="db-port" className="label">Port</label>
            <input
              id="db-port"
              type="number"
              className="input-field"
              value={config.port}
              onChange={(e) => setConfig((prev) => ({ ...prev, port: parseInt(e.target.value, 10) || 0 }))}
              min={1}
              max={65535}
            />
            {fieldErrors.port ? (
              <p className="error-text" data-testid="db-error-port">{fieldErrors.port}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="db-name" className="label">Database Name</label>
            <input
              id="db-name"
              type="text"
              className="input-field"
              value={config.database}
              onChange={(e) => setConfig((prev) => ({ ...prev, database: e.target.value }))}
              placeholder="proctira"
            />
            {fieldErrors.database ? (
              <p className="error-text" data-testid="db-error-database">{fieldErrors.database}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="db-pool" className="label">Pool Size</label>
            <input
              id="db-pool"
              type="number"
              className="input-field"
              value={config.poolSize ?? 10}
              onChange={(e) => setConfig((prev) => ({ ...prev, poolSize: parseInt(e.target.value, 10) || 10 }))}
              min={1}
              max={100}
            />
            {fieldErrors.poolSize ? (
              <p className="error-text" data-testid="db-error-pool">{fieldErrors.poolSize}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="db-user" className="label">Username</label>
            <input
              id="db-user"
              type="text"
              className="input-field"
              value={config.username}
              onChange={(e) => setConfig((prev) => ({ ...prev, username: e.target.value }))}
              placeholder="postgres"
            />
            {fieldErrors.username ? (
              <p className="error-text" data-testid="db-error-username">{fieldErrors.username}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="db-pass" className="label">Password</label>
            <input
              id="db-pass"
              type="password"
              className="input-field"
              value={config.password}
              onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="••••••••"
            />
            {fieldErrors.password ? (
              <p className="error-text" data-testid="db-error-password">{fieldErrors.password}</p>
            ) : null}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.ssl ?? false}
            onChange={(e) => setConfig((prev) => ({ ...prev, ssl: e.target.checked }))}
            className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-700">Enable SSL/TLS connection</span>
        </label>

        {result && (
          <StatusMessage
            type={result.success ? 'success' : 'error'}
            title={result.success ? 'Connection successful' : 'Connection failed'}
            message={result.success ? result.message : (result.error ?? result.message)}
            latencyMs={result.latencyMs}
            onRetry={result.success ? undefined : () => setResult(null)}
          />
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => { void handleTest(); }}
            disabled={testing}
            className="btn-primary"
            data-testid="database-test-submit"
          >
            {testing ? (
              <>
                <LoadingSpinner />
                Testing Connection...
              </>
            ) : (
              'Test Connection & Continue'
            )}
          </button>
        </div>
      </div>
    </StepCard>
  );
}

function LoadingSpinner() {
  return (
    <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
