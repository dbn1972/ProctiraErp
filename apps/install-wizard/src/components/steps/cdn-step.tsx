'use client';

import { useState } from 'react';
import { StepCard } from '@/components/step-card';
import { StatusMessage } from '@/components/status-message';
import { apiClient, type CdnConfig, type ValidationResult } from '@/lib/api-client';

interface CdnStepProps {
  onComplete: () => void;
  onBack: () => void;
}

type CdnAdapter = 'cloudfront' | 'nginx' | 'custom';

export function CdnStep({ onComplete, onBack }: CdnStepProps) {
  const [config, setConfig] = useState<CdnConfig>({
    adapter: 'nginx',
    baseUrl: 'http://localhost:8080',
    tenantAware: true,
    brandingPrefix: '/branding',
    staticPrefix: '/static',
  });
  const [cloudfrontConfig, setCloudfrontConfig] = useState({
    distributionId: '',
    region: 'us-east-1',
  });
  const [customConfig, setCustomConfig] = useState({
    invalidationEndpoint: '',
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const buildPayload = (): CdnConfig => {
    const payload: CdnConfig = {
      adapter: config.adapter,
      baseUrl: config.baseUrl,
      tenantAware: config.tenantAware,
      brandingPrefix: config.brandingPrefix || undefined,
      staticPrefix: config.staticPrefix || undefined,
    };
    if (config.adapter === 'cloudfront') {
      payload.cloudfront = {
        distributionId: cloudfrontConfig.distributionId,
        region: cloudfrontConfig.region || undefined,
      };
    }
    if (config.adapter === 'custom' && customConfig.invalidationEndpoint) {
      payload.custom = {
        invalidationEndpoint: customConfig.invalidationEndpoint,
      };
    }
    return payload;
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await apiClient.configureCdn(buildPayload());
      setResult(response);
      if (response.success) {
        setTimeout(onComplete, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        step: 'cdn',
        message: 'Asset delivery test failed',
        error: err instanceof Error ? err.message : 'Unable to reach the install service.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <StepCard
      title="Step 5: CDN Configuration"
      description="Configure content delivery for static assets, branding, and tenant-specific resources. An asset delivery test will verify the setup."
    >
      <div className="space-y-4">
        {/* Adapter Selection */}
        <fieldset>
          <legend className="label">CDN Provider</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(['nginx', 'cloudfront', 'custom'] as const).map((adapter) => (
              <label
                key={adapter}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50"
              >
                <input
                  type="radio"
                  name="cdn-adapter"
                  value={adapter}
                  checked={config.adapter === adapter}
                  onChange={() => {
                    setConfig((prev) => ({ ...prev, adapter }));
                    setResult(null);
                  }}
                  className="text-primary-700 focus:ring-primary-500"
                />
                <span className="text-sm font-medium">
                  {adapter === 'nginx'
                    ? 'Nginx'
                    : adapter === 'cloudfront'
                      ? 'CloudFront'
                      : 'Custom'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Common Fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="cdn-url" className="label">
              Base URL
            </label>
            <input
              id="cdn-url"
              type="text"
              className="input-field"
              value={config.baseUrl}
              onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://cdn.example.com"
            />
          </div>
          <div>
            <label htmlFor="cdn-branding" className="label">
              Branding Prefix
            </label>
            <input
              id="cdn-branding"
              type="text"
              className="input-field"
              value={config.brandingPrefix ?? ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, brandingPrefix: e.target.value }))}
              placeholder="/branding"
            />
          </div>
          <div>
            <label htmlFor="cdn-static" className="label">
              Static Prefix
            </label>
            <input
              id="cdn-static"
              type="text"
              className="input-field"
              value={config.staticPrefix ?? ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, staticPrefix: e.target.value }))}
              placeholder="/static"
            />
          </div>
        </div>

        {/* CloudFront-specific */}
        {config.adapter === 'cloudfront' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cf-dist" className="label">
                Distribution ID
              </label>
              <input
                id="cf-dist"
                type="text"
                className="input-field"
                value={cloudfrontConfig.distributionId}
                onChange={(e) =>
                  setCloudfrontConfig((prev) => ({ ...prev, distributionId: e.target.value }))
                }
                placeholder="E1234567890ABC"
              />
            </div>
            <div>
              <label htmlFor="cf-region" className="label">
                Region
              </label>
              <input
                id="cf-region"
                type="text"
                className="input-field"
                value={cloudfrontConfig.region}
                onChange={(e) =>
                  setCloudfrontConfig((prev) => ({ ...prev, region: e.target.value }))
                }
                placeholder="us-east-1"
              />
            </div>
          </div>
        )}

        {/* Custom-specific */}
        {config.adapter === 'custom' && (
          <div>
            <label htmlFor="custom-invalidation" className="label">
              Invalidation Endpoint (optional)
            </label>
            <input
              id="custom-invalidation"
              type="text"
              className="input-field"
              value={customConfig.invalidationEndpoint}
              onChange={(e) =>
                setCustomConfig((prev) => ({ ...prev, invalidationEndpoint: e.target.value }))
              }
              placeholder="https://cdn.example.com/invalidate"
            />
          </div>
        )}

        {/* Tenant Aware Toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.tenantAware}
            onChange={(e) => setConfig((prev) => ({ ...prev, tenantAware: e.target.checked }))}
            className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-700">Enable tenant-aware asset paths</span>
        </label>

        {/* Status Message */}
        {result && (
          <StatusMessage
            type={result.success ? 'success' : 'error'}
            title={result.success ? 'Asset delivery test passed' : 'CDN test failed'}
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
            disabled={testing || !config.baseUrl}
            className="btn-primary"
          >
            {testing ? (
              <>
                <LoadingSpinner />
                Testing Asset Delivery...
              </>
            ) : (
              'Test Delivery & Continue'
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
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
