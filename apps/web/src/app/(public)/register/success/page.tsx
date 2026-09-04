import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { DocumentTitle } from '@/components/DocumentTitle';

import { SuccessView } from './success-view';

export default function RegisterSuccessPage(): JSX.Element {
  return (
    <main>
      <DocumentTitle pageTitle="Application submitted" />
      <Suspense
        fallback={
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <SuccessView />
      </Suspense>
    </main>
  );
}
