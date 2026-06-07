'use client';

import { useState } from 'react';
import { StepCard } from '@/components/step-card';
import { StatusMessage } from '@/components/status-message';
import { apiClient, type StorageConfig, type ValidationResult } from '@/lib/api-client';

interface StorageStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function StorageStep({ onComplete, onBack }: StorageStepProps) {
  const [config, setConfig] = useState<StorageConfig>({
    adapter: 's3',
    bucket: 'proctira-uploads',
    region: 'us-east-1',
    endpoint: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: false,
    useSSL: true,
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const payload: StorageConfig = { ...config };
      // Clean optional empty strings
      if (!payload.endpoint) delete payload.endpoint;
      if (!payload.accessKeyId) delete payload.accessKeyId;
      if (!payload.secretAccessKey) delete payload.secretAccessKey;
      if (!payload.region) delete payload.region;

      const response = await apiClient.configureStorage(payload);
      setResult(response);
      if (response.success) {
        setTimeout(onComplete, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        step: 'storage',
        message: 'Upload test failed',
        error: err instanceof Error ? err.message : 'Unable to reach the install service.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <StepCard
      title="Step 2: Object Storage Configuration"
      description="Configure your object storage for file uploads (documents, photos, exports). A test upload will verify connectivity."
    >
      <div className="space-y-4">
        {/* Adapter Selection */}
        <fieldset>
          <legend className="label">Storage Provider</legend>
          <div className="mt-2 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
              <input
                type="radio"
                name="storage-adapter"
                value="s3"
                checked={config.adapter === 's3'}
                onChange={() => { setConfig((prev) => ({ ...prev, adapter: 's3' })); setResult(null); }}
                className="text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm font-medium">Amazon S3</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
              <input
                type="radio"
                name="storage-adapter"
                value="minio"
                checked={config.adapter === 'minio'}
                onChange={() => { setConfig((prev) => ({ ...prev, adapter: 'minio', forcePathStyle: true })); setResult(null); }}
                className="text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm font-medium">MinIO</span>
            </label>
          </div>
        </fieldset>

        {/* Connection Details */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="storage-bucket" className="label">Bucket Name</label>
            <input
              id="storage-bucket"
              type="text"
              className="input-field"
              value={config.bucket}
              onChange={(e) => setConfig((prev) => ({ ...prev, bucket: e.target.value }))}
              placeholder="proctira-uploads"
            />
          </div>
          <div>
            <label htmlFor="storage-region" className="label">Region</label>
            <input
              id="storage-region"
              type="text"
              className="input-field"
              value={config.region ?? ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, region: e.target.value }))}
              placeholder="us-east-1"
            />
          </div>
          {config.adapter === 'minio' && (
            <div className="sm:col-span-2">
              <label htmlFor="storage-endpoint" className="label">Endpoint URL</label>
              <input
                id="storage-endpoint"
                type="text"
                className="input-field"
                value={config.endpoint ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                placeholder="http://localhost:9000"
              />
            </div>
          )}
          <div>
            <label htmlFor="storage-key" className="label">Access Key ID</label>
            <input
              id="storage-key"
              type="text"
              className="input-field"
              value={config.accessKeyId ?? ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, accessKeyId: e.target.value }))}
              placeholder="AKIAIOSFODNN7EXAMPLE"
            />
          </div>
          <div>
            <label htmlFor="storage-secret" className="label">Secret Access Key</label>
            <input
              id="storage-secret"
              type="password"
              className="input-field"
              value={config.secretAccessKey ?? ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, secretAccessKey: e.target.value }))}
              placeholder="••••••••"
            />
          </div>
        </div>

        {/* SSL Toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.useSSL ?? true}
            onChange={(e) => setConfig((prev) => ({ ...prev, useSSL: e.target.checked }))}
            className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-700">Use SSL/TLS</span>
        </label>

        {/* Status Message */}
        {result && (
          <StatusMessage
            type={result.success ? 'success' : 'error'}
            title={result.success ? 'Upload test passed' : 'Upload test failed'}
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
            disabled={testing || !config.bucket}
            className="btn-primary"
          >
            {testing ? (
              <>
                <LoadingSpinner />
                Testing Upload...
              </>
            ) : (
              'Test Upload & Continue'
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
