'use client';

import type { StepState } from '@/lib/use-wizard';

interface StepperProps {
  steps: StepState[];
  currentStepIndex: number;
}

export function Stepper({ steps, currentStepIndex: _currentStepIndex }: StepperProps) {
  return (
    <nav
      aria-label="Setup progress"
      tabIndex={0}
      className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white px-4 py-5 shadow-sm sm:px-6"
    >
      <ol className="flex min-w-max items-start sm:min-w-0">
        {steps.map((step, index) => {
          const isActive = step.status === 'active';
          return (
            <li
              key={step.id}
              className={`flex items-start ${index < steps.length - 1 ? 'flex-1' : ''}`}
            >
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all ${
                    step.status === 'completed'
                      ? 'border-primary-700 bg-primary-700 text-white'
                      : isActive
                        ? 'border-primary-700 bg-primary-700 text-white ring-4 ring-primary-200'
                        : step.status === 'failed'
                          ? 'border-red-500 bg-red-500 text-white'
                          : 'border-gray-300 bg-gray-50 text-gray-400'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
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
                  className={`mt-2 max-w-[5.5rem] text-center text-xs leading-tight whitespace-nowrap ${
                    isActive
                      ? 'font-semibold text-gray-900'
                      : step.status === 'completed'
                        ? 'font-medium text-primary-700'
                        : 'text-gray-600'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-1 mt-[18px] h-0.5 flex-1 rounded-full sm:mx-2 ${
                    step.status === 'completed' ? 'bg-primary-700' : 'bg-gray-200'
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
