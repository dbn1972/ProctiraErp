'use client';

import type { StepState } from '@/lib/use-wizard';

interface StepperProps {
  steps: StepState[];
  currentStepIndex: number;
}

export function Stepper({ steps, currentStepIndex }: StepperProps) {
  return (
    <nav aria-label="Setup progress" className="mb-8">
      <ol className="flex items-center">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}
          >
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors ${
                  step.status === 'completed'
                    ? 'border-green-500 bg-green-500 text-white'
                    : step.status === 'active'
                      ? 'border-primary-700 bg-primary-700 text-white'
                      : step.status === 'failed'
                        ? 'border-red-500 bg-red-500 text-white'
                        : 'border-gray-300 bg-white text-gray-500'
                }`}
                aria-current={step.status === 'active' ? 'step' : undefined}
              >
                {step.status === 'completed' ? (
                  <CheckIcon />
                ) : step.status === 'failed' ? (
                  <XIcon />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={`mt-1 text-xs whitespace-nowrap ${
                  index === currentStepIndex
                    ? 'font-medium text-primary-700'
                    : 'text-gray-500'
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 ${
                  step.status === 'completed' ? 'bg-green-500' : 'bg-gray-200'
                }`}
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
