'use client';

import { StepCard } from '@/components/step-card';
import { getWebAppLoginUrl } from '@/lib/site';

export function CompleteStep() {
  const dashboardHref = getWebAppLoginUrl();

  return (
    <StepCard
      title="Setup Complete"
      description="Your ProctiraERP platform has been configured successfully."
    >
      <div className="text-center py-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-8 w-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">All services configured</h3>
        <p className="mx-auto mb-6 max-w-md text-sm text-gray-600">
          Database, object storage, cache, message queue, and CDN are all connected and verified.
          Your admin account and initial tenant have been created.
        </p>
        <div className="space-y-3">
          <a href={dashboardHref} className="btn-primary inline-block" rel="noopener noreferrer">
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
