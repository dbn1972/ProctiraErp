'use client';

import { useState } from 'react';
import { StepCard } from '@/components/step-card';
import { StatusMessage } from '@/components/status-message';
import { apiClient, type CacheConfig, type ValidationResult } from '@/lib/api-client';

interface CacheStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function CacheStep({ onComplete, onBack }: CacheStepProps) {
  const [config, setConfig] = useState<CacheConfig>({
    adapter: 'redis',
    host: 'localhost',
    port: 6379,
    password: '',
    db: 0,
    tls: false,
    keyPrefix: 'proctira:',
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const payload: CacheConfig = { ...config };
      if (!payload.password) delete payload.password;
      if (!payload.keyPrefix) delete payload.keyPrefix;

      const response = await apiClient.configureCache(payload);
      setResult(response);
      if (response.success) {
        setTimeout(onComplete, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        step: 'cache',
        message: 'Connectivity test failed',
        error: err instanceof Error ? err.message : 'Unable to reach the install service.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <StepCard
      title="Step 3: Redis Cache Configuration"
      description="Configure Redis for session management, query caching, and real-time features. A PING test will verify connectivity."
    >
      <div className="space-y-4">
        {/* Adapter Selection */}
        <fieldset>
          <legend className="label">Cache Adapter</legend>
          <div className="mt-2 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
              <input
                type="radio"
                name="cache-adapter"
                value="redis"
                checked={config.adapter === 'redis'}
                onChange={() => { setConfig((prev) => ({ ...prev, adapter: 'redis' })); setResult(null); }}
                className="text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm font-medium">Redis</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
              <input
                type="radio"
                name="cache-adapter"
                value="memory"
                checked={config.adapter === 'memory'}
                onChange={() => { setConfig((prev) => ({ ...prev, adapter: 'memory' })); setResult(null); }}
                className="text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm font-medium">In-Memory (dev only)</span>
            </label>
          </div>
        </fieldset>

        {/* Redis Connection Details */}
        {config.adapter === 'redis' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cache-host" className="label">Host</label>
              <input
                id="cache-host"
                type="text"
                className="input-field"
                value={config.host ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, host: e.target.value }))}
                placeholder="localhost"
              />
            </div>
            <div>
              <label htmlFor="cache-port" className="label">Port</label>
              <input
                id="cache-port"
                type="number"
                className="input-field"
                value={config.port ?? 6379}
                onChange={(e) => setConfig((prev) => ({ ...prev, port: parseInt(e.target.value, 10) || 6379 }))}
                min={1}
                max={65535}
              />
            </div>
            <div>
              <label htmlFor="cache-password" className="label">Password (optional)</label>
              <input
                id="cache-password"
                type="password"
                className="input-field"
                value={config.password ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Leave empty if no auth"
              />
            </div>
            <div>
              <label htmlFor="cache-db" className="label">Database Index</label>
              <input
                id="cache-db"
                type="number"
                className="input-field"
                value={config.db ?? 0}
                onChange={(e) => setConfig((prev) => ({ ...prev, db: parseInt(e.target.value, 10) || 0 }))}
                min={0}
                max={15}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="cache-prefix" className="label">Key Prefix</label>
              <input
                id="cache-prefix"
                type="text"
                className="input-field"
                value={config.keyPrefix ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, keyPrefix: e.target.value }))}
                placeholder="proctira:"
              />
            </div>
          </div>
        )}

        {config.adapter === 'memory' && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3">
            <p className="text-sm text-yellow-800">
              <strong>Warning:</strong> In-memory cache is not suitable for production. Data is lost on restart and not shared across instances.
            </p>
          </div>
        )}

        {/* TLS Toggle */}
        {config.adapter === 'redis' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.tls ?? false}
              onChange={(e) => setConfig((prev) => ({ ...prev, tls: e.target.checked }))}
              className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Enable TLS encryption</span>
          </label>
        )}

        {/* Status Message */}
        {result && (
          <StatusMessage
            type={result.success ? 'success' : 'error'}
            title={result.success ? 'Redis connectivity confirmed' : 'Connectivity test failed'}
            message={result.success ? result.message : (result.error ?? result.message)}
            latencyMs={result.latencyMs}
            onRetry={result.success ? undefined : () => setResult(null)}
          />
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <button type="button" onClick={onBack} className="btn-secondary">
            Back
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || (config.adapter === 'redis' && !config.host)}
            className="btn-primary"
          >
            {testing ? (
              <>
                <LoadingSpinner />
                Testing Connectivity...
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
