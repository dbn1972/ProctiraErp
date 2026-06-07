import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { RegistrationProvider } from '@/components/registration/registration-context';
import { ApplyStepper } from '@/components/registration/apply-stepper';

/**
 * Layout for the multi-step apply flow.
 *
 * Wraps every `/apply/[institutionType]/*` page in a RegistrationProvider so
 * that form state (personal info, documents) is shared across the steps via
 * sessionStorage.
 */
export default function ApplyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { institutionType: string };
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <RegistrationProvider institutionType={params.institutionType}>
            <div className="mb-8">
              <ApplyStepper />
            </div>
            {children}
          </RegistrationProvider>
        </div>
      </main>
      <Footer />
    </div>
  );
}
