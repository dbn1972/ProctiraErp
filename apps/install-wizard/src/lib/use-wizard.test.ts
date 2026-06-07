import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWizard } from './use-wizard';

describe('useWizard', () => {
  it('initializes with database as the first active step', () => {
    const { result } = renderHook(() => useWizard());

    expect(result.current.currentStep).toBe('database');
    expect(result.current.currentStepIndex).toBe(0);
    expect(result.current.isFirstStep).toBe(true);
    expect(result.current.isLastStep).toBe(false);
    expect(result.current.totalSteps).toBe(6);
  });

  it('advances to the next step when goToNext is called', () => {
    const { result } = renderHook(() => useWizard());

    act(() => {
      result.current.markCurrentCompleted();
      result.current.goToNext();
    });

    expect(result.current.currentStep).toBe('storage');
    expect(result.current.currentStepIndex).toBe(1);
    expect(result.current.isFirstStep).toBe(false);
  });

  it('goes back to the previous step when goToPrevious is called', () => {
    const { result } = renderHook(() => useWizard());

    act(() => {
      result.current.markCurrentCompleted();
      result.current.goToNext();
    });

    act(() => {
      result.current.goToPrevious();
    });

    expect(result.current.currentStep).toBe('database');
    expect(result.current.currentStepIndex).toBe(0);
  });

  it('marks the current step as completed', () => {
    const { result } = renderHook(() => useWizard());

    act(() => {
      result.current.markCurrentCompleted();
    });

    expect(result.current.steps[0]!.status).toBe('completed');
  });

  it('marks the current step as failed', () => {
    const { result } = renderHook(() => useWizard());

    act(() => {
      result.current.markCurrentFailed();
    });

    expect(result.current.steps[0]!.status).toBe('failed');
  });

  it('resets the current step to active', () => {
    const { result } = renderHook(() => useWizard());

    act(() => {
      result.current.markCurrentFailed();
    });

    act(() => {
      result.current.resetCurrentStep();
    });

    expect(result.current.steps[0]!.status).toBe('active');
  });

  it('does not go below step 0', () => {
    const { result } = renderHook(() => useWizard());

    act(() => {
      result.current.goToPrevious();
    });

    expect(result.current.currentStepIndex).toBe(0);
    expect(result.current.currentStep).toBe('database');
  });

  it('progresses through all steps in order', () => {
    const { result } = renderHook(() => useWizard());
    const expectedSteps = ['database', 'storage', 'cache', 'queue', 'cdn', 'admin'];

    for (let i = 0; i < expectedSteps.length; i++) {
      expect(result.current.currentStep).toBe(expectedSteps[i]);
      act(() => {
        result.current.markCurrentCompleted();
        result.current.goToNext();
      });
    }

    // After completing all steps, all should be completed
    expect(result.current.steps.every((s) => s.status === 'completed')).toBe(true);
  });
});
