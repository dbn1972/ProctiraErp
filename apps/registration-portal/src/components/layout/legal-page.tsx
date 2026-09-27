import { getTranslations } from 'next-intl/server';

import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';

type LegalSection = {
  titleKey: string;
  bodyKey: string;
};

/**
 * Tenant-facing legal page for applicants. Copy comes from the message
 * catalog and speaks to the school running this portal.
 */
export async function LegalPage({
  titleKey,
  leadKey,
  sections,
}: {
  titleKey: string;
  leadKey: string;
  sections: LegalSection[];
}) {
  const t = await getTranslations('legal');
  const text = (key: string) => t(key as never);
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{text(titleKey)}</h1>
          <p className="mt-4 text-base leading-relaxed text-gray-700">{text(leadKey)}</p>
          <div className="mt-8 space-y-6">
            {sections.map((section) => (
              <section key={section.titleKey}>
                <h2 className="text-lg font-bold text-gray-900">{text(section.titleKey)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  {text(section.bodyKey)}
                </p>
              </section>
            ))}
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
