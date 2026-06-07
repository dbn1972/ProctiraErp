'use client';

import { StepCard } from '@/components/step-card';

export function CompleteStep() {
  return (
    <StepCard
      title="Setup Complete"
      description="Your ProctiraERP platform has been configured successfully."
    >
      <div className="text-center py-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-4">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          All services configured
        </h3>
        <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
          Database, object storage, cache, message queue, and CDN are all connected and verified.
          Your admin account and initial tenant have been created.
        </p>
        <div className="space-y-3">
          <a
            href="/"
            className="btn-primary inline-block"
          >
            Go to Dashboard
          </a>
          <p className="text-xs text-gray-500">
            You can reconfigure services later from the Admin panel.
          </p>
        </div>
      </div>
    </StepCard>
  );
}
