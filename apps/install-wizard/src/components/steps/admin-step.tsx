'use client';

import { useState } from 'react';

import { StatusMessage } from '@/components/status-message';
import { StepCard } from '@/components/step-card';
import { validateAdminAccount, type AdminAccountFieldErrors } from '@/lib/admin-validation';
import { apiClient, type AdminAccountConfig } from '@/lib/api-client';

interface AdminStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function AdminStep({ onComplete, onBack }: AdminStepProps) {
  const [config, setConfig] = useState<AdminAccountConfig>({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    tenantName: '',
    tenantSlug: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [validationErrors, setValidationErrors] = useState<AdminAccountFieldErrors>({});

  const validate = (): boolean => {
    const errors = validateAdminAccount({ ...config, confirmPassword });
    setValidationErrors(errors ?? {});
    return errors === null;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    setResult(null);
    try {
      // First create admin account
      const adminResult = await apiClient.createAdminAccount(config);
      if (!adminResult.success) {
        setResult(adminResult);
        return;
      }

      // Then finalize the bootstrap
      const finalizeResult = await apiClient.finalize();
      if (finalizeResult.success) {
        setResult({ success: true });
        setTimeout(onComplete, 1500);
      } else {
        setResult({ success: false, error: finalizeResult.error ?? 'Finalization failed' });
      }
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unable to reach the install service.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTenantNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    setConfig((prev) => ({ ...prev, tenantName: name, tenantSlug: slug }));
  };

  return (
    <StepCard
      title="Step 6: Admin Account & Tenant Setup"
      description="Create the platform administrator account and configure the initial tenant. This account will have full system access."
    >
      <div className="space-y-6">
        {/* Admin Account Section */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
            Administrator Account
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-first" className="label">
                First Name
              </label>
              <input
                id="admin-first"
                type="text"
                className="input-field"
                value={config.firstName}
                onChange={(e) => setConfig((prev) => ({ ...prev, firstName: e.target.value }))}
                placeholder="Admin"
              />
              {validationErrors.firstName && (
                <p className="error-text">{validationErrors.firstName}</p>
              )}
            </div>
            <div>
              <label htmlFor="admin-last" className="label">
                Last Name
              </label>
              <input
                id="admin-last"
                type="text"
                className="input-field"
                value={config.lastName}
                onChange={(e) => setConfig((prev) => ({ ...prev, lastName: e.target.value }))}
                placeholder="User"
              />
              {validationErrors.lastName && (
                <p className="error-text">{validationErrors.lastName}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="admin-email" className="label">
                Email Address
              </label>
              <input
                id="admin-email"
                type="email"
                className="input-field"
                value={config.email}
                onChange={(e) => setConfig((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="admin@example.com"
              />
              {validationErrors.email && <p className="error-text">{validationErrors.email}</p>}
            </div>
            <div>
              <label htmlFor="admin-pass" className="label">
                Password
              </label>
              <input
                id="admin-pass"
                type="password"
                className="input-field"
                value={config.password}
                onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Min. 8 characters"
              />
              {validationErrors.password && (
                <p className="error-text">{validationErrors.password}</p>
              )}
            </div>
            <div>
              <label htmlFor="admin-confirm" className="label">
                Confirm Password
              </label>
              <input
                id="admin-confirm"
                type="password"
                className="input-field"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
              />
              {validationErrors.confirmPassword && (
                <p className="error-text">{validationErrors.confirmPassword}</p>
              )}
            </div>
          </div>
        </div>

        {/* Tenant Section */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
            Initial Tenant
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tenant-name" className="label">
                Tenant Name
              </label>
              <input
                id="tenant-name"
                type="text"
                className="input-field"
                value={config.tenantName}
                onChange={(e) => handleTenantNameChange(e.target.value)}
                placeholder="My Organization"
              />
              {validationErrors.tenantName && (
                <p className="error-text">{validationErrors.tenantName}</p>
              )}
            </div>
            <div>
              <label htmlFor="tenant-slug" className="label">
                Tenant Slug (subdomain)
              </label>
              <input
                id="tenant-slug"
                type="text"
                className="input-field"
                value={config.tenantSlug}
                onChange={(e) => setConfig((prev) => ({ ...prev, tenantSlug: e.target.value }))}
                placeholder="my-organization"
              />
              <p className="mt-1 text-xs text-gray-500">
                Access URL:{' '}
                <code className="bg-gray-100 px-1 rounded">
                  {config.tenantSlug || 'slug'}.proctira.org
                </code>
              </p>
              {validationErrors.tenantSlug && (
                <p className="error-text">{validationErrors.tenantSlug}</p>
              )}
            </div>
          </div>
        </div>

        {/* Status Message */}
        {result && (
          <StatusMessage
            type={result.success ? 'success' : 'error'}
            title={result.success ? 'Setup complete!' : 'Setup failed'}
            message={
              result.success
                ? 'Admin account created and platform bootstrapped successfully.'
                : (result.error ?? 'An error occurred during setup.')
            }
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
            onClick={() => {
              void handleSubmit();
            }}
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? (
              <>
                <LoadingSpinner />
                Creating Account...
              </>
            ) : (
              'Complete Setup'
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
