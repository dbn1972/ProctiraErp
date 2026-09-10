'use client';

import { useState, useCallback } from 'react';

export type WizardStep = 'database' | 'storage' | 'cache' | 'queue' | 'cdn' | 'admin' | 'complete';

export type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface StepState {
  id: WizardStep;
  label: string;
  description: string;
  status: StepStatus;
}

const INITIAL_STEPS: StepState[] = [
  {
    id: 'database',
    label: 'Database',
    description: 'Configure database connection',
    status: 'active',
  },
  {
    id: 'storage',
    label: 'Object Storage',
    description: 'Configure file storage',
    status: 'pending',
  },
  {
    id: 'cache',
    label: 'Redis Cache',
    description: 'Configure cache layer',
    status: 'pending',
  },
  {
    id: 'queue',
    label: 'Message Queue',
    description: 'Configure message broker',
    status: 'pending',
  },
  {
    id: 'cdn',
    label: 'CDN',
    description: 'Configure content delivery',
    status: 'pending',
  },
  {
    id: 'admin',
    label: 'Admin Account',
    description: 'Create admin and tenant',
    status: 'pending',
  },
];

export interface UseWizardReturn {
  steps: StepState[];
  currentStep: WizardStep;
  currentStepIndex: number;
  totalSteps: number;
  goToNext: () => void;
  goToPrevious: () => void;
  markCurrentCompleted: () => void;
  markCurrentFailed: () => void;
  resetCurrentStep: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
}

export function useWizard(): UseWizardReturn {
  const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = steps[currentStepIndex]!.id;
  const totalSteps = steps.length;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  const goToNext = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setSteps((prev) =>
        prev.map((step, i) => {
          if (i === currentStepIndex + 1) {
            return { ...step, status: 'active' };
          }
          return step;
        }),
      );
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      // All steps done, move to complete
      setSteps((prev) => prev.map((step) => ({ ...step, status: 'completed' })));
    }
  }, [currentStepIndex, steps.length]);

  const goToPrevious = useCallback(() => {
    if (currentStepIndex > 0) {
      setSteps((prev) =>
        prev.map((step, i) => {
          if (i === currentStepIndex) {
            return { ...step, status: 'pending' };
          }
          if (i === currentStepIndex - 1) {
            return { ...step, status: 'active' };
          }
          return step;
        }),
      );
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const markCurrentCompleted = useCallback(() => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i === currentStepIndex) {
          return { ...step, status: 'completed' };
        }
        return step;
      }),
    );
  }, [currentStepIndex]);

  const markCurrentFailed = useCallback(() => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i === currentStepIndex) {
          return { ...step, status: 'failed' };
        }
        return step;
      }),
    );
  }, [currentStepIndex]);

  const resetCurrentStep = useCallback(() => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i === currentStepIndex) {
          return { ...step, status: 'active' };
        }
        return step;
      }),
    );
  }, [currentStepIndex]);

  return {
    steps,
    currentStep,
    currentStepIndex,
    totalSteps,
    goToNext,
    goToPrevious,
    markCurrentCompleted,
    markCurrentFailed,
    resetCurrentStep,
    isFirstStep,
    isLastStep,
  };
}
