import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { DocumentTitle } from '@/components/DocumentTitle';

import { ApplyWizard } from './apply-wizard';

export default function RegisterApplyPage(): JSX.Element {
  return (
    <main>
      <DocumentTitle pageTitle="Register" />
      <Suspense
        fallback={
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <ApplyWizard />
      </Suspense>
    </main>
  );
}
