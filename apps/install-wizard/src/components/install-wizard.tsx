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
    <div className="mx-auto max-w-3xl">
      {/* Brand header */}
      <div className="mb-8 flex items-center justify-center gap-2.5 text-gray-900">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-800 text-lg font-extrabold text-white shadow-inner"
          aria-hidden="true"
        >
          P
        </span>
        <span className="text-[17px] font-bold tracking-tight">
          Proctira<span className="text-primary-600">ERP</span>
        </span>
        <span className="text-gray-300">·</span>
        <span className="text-sm font-semibold text-gray-500">Self-hosted setup</span>
      </div>

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

      <p className="mt-6 text-center text-xs text-gray-500">
        ProctiraERP · Installer ·{' '}
        <a href="#docs" className="font-semibold text-primary-700 hover:underline">
          Installation guide
        </a>{' '}
        ·{' '}
        <a href="#support" className="font-semibold text-primary-700 hover:underline">
          Get help
        </a>
      </p>
    </div>
  );
}
