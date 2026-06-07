'use client';

import { useWizard } from '@/lib/use-wizard';
import { Stepper } from '@/components/stepper';
import {
  DatabaseStep,
  StorageStep,
  CacheStep,
  QueueStep,
  CdnStep,
  AdminStep,
  CompleteStep,
} from '@/components/steps';

export function InstallWizard() {
  const wizard = useWizard();

  const handleStepComplete = () => {
    wizard.markCurrentCompleted();
    wizard.goToNext();
  };

  const handleStepBack = () => {
    wizard.goToPrevious();
  };

  // Check if all steps are completed
  const allCompleted = wizard.steps.every((s) => s.status === 'completed');

  return (
    <div className="mx-auto max-w-4xl">
      <Stepper steps={wizard.steps} currentStepIndex={wizard.currentStepIndex} />

      {allCompleted ? (
        <CompleteStep />
      ) : (
        <>
          {wizard.currentStep === 'database' && (
            <DatabaseStep onComplete={handleStepComplete} />
          )}
          {wizard.currentStep === 'storage' && (
            <StorageStep onComplete={handleStepComplete} onBack={handleStepBack} />
          )}
          {wizard.currentStep === 'cache' && (
            <CacheStep onComplete={handleStepComplete} onBack={handleStepBack} />
          )}
          {wizard.currentStep === 'queue' && (
            <QueueStep onComplete={handleStepComplete} onBack={handleStepBack} />
          )}
          {wizard.currentStep === 'cdn' && (
            <CdnStep onComplete={handleStepComplete} onBack={handleStepBack} />
          )}
          {wizard.currentStep === 'admin' && (
            <AdminStep onComplete={handleStepComplete} onBack={handleStepBack} />
          )}
        </>
      )}
    </div>
  );
}
