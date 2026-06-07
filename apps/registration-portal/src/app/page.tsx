import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GraduationCap, MapPin, FileText, Search, Upload, CheckCircle2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

/**
 * Public-facing landing page for the Registration Portal.
 *
 * Matches the Figma design (45-registration-landing.md):
 *   - Hero with primary "Apply" and secondary "Track" CTAs
 *   - Stats bar
 *   - "How it works" 4-step section
 *   - Important dates / footer
 *
 * No authentication is required to reach this page.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />

      <main className="flex-1">
        <Hero />
        <StatsBar />
        <HowItWorks />
        <InstitutionTypePicker />
      </main>

      <Footer />
    </div>
  );
}

function Hero() {
  const t = useTranslations('landing');
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary-700 to-primary-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-4 max-w-xl text-base text-white/85 sm:text-lg">{t('heroSubtitle')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="#apply"
                className="inline-flex h-12 items-center justify-center rounded-md bg-accent-600 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-700"
              >
                {t('applyCta')}
              </Link>
              <Link
                href="/track"
                className="btn-outline-white h-12 px-6 text-base font-semibold"
              >
                {t('trackCta')}
              </Link>
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="rounded-xl bg-white/10 p-8 backdrop-blur-sm ring-1 ring-white/20">
              <div className="grid grid-cols-2 gap-4">
                <FeatureBadge icon={<GraduationCap className="h-6 w-6" />} title={t('step2Title')} />
                <FeatureBadge icon={<MapPin className="h-6 w-6" />} title={t('step1Title')} />
                <FeatureBadge icon={<Upload className="h-6 w-6" />} title={t('step3Title')} />
                <FeatureBadge icon={<CheckCircle2 className="h-6 w-6" />} title={t('step4Title')} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureBadge({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-white/10 px-4 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-600 text-white">{icon}</div>
      <span className="text-sm font-medium">{title}</span>
    </div>
  );
}

function StatsBar() {
  const t = useTranslations('landing.stats');
  const stats = [
    { value: '12,847', label: t('schools') },
    { value: '2.5M', label: t('students') },
    { value: '98%', label: t('processed') },
    { value: '✓', label: t('open') },
  ];
  return (
    <section className="bg-white shadow-sm">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-6 sm:grid-cols-4 sm:px-6 lg:px-8">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-2xl font-bold text-primary-700 sm:text-3xl">{s.value}</p>
            <p className="mt-1 text-xs text-gray-500 sm:text-sm">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const t = useTranslations('landing');
  const steps = [
    { n: 1, title: t('step1Title'), desc: t('step1Desc'), icon: <Search className="h-6 w-6" /> },
    { n: 2, title: t('step2Title'), desc: t('step2Desc'), icon: <FileText className="h-6 w-6" /> },
    { n: 3, title: t('step3Title'), desc: t('step3Desc'), icon: <Upload className="h-6 w-6" /> },
    { n: 4, title: t('step4Title'), desc: t('step4Desc'), icon: <CheckCircle2 className="h-6 w-6" /> },
  ];

  return (
    <section className="bg-gray-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">{t('stepsTitle')}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.n} className="card text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white">
                {step.n}
              </div>
              <div className="mt-4 flex justify-center text-primary-700">{step.icon}</div>
              <h3 className="mt-3 text-base font-semibold text-gray-900">{step.title}</h3>
              <p className="mt-1 text-sm text-gray-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InstitutionTypePicker() {
  const t = useTranslations('landing');
  // Public registration is keyed by institution type (primary / secondary / TVET / preschool).
  // The server resolves the actual institution + form configuration.
  const types = [
    { id: 'primary', label: t('primary') },
    { id: 'secondary', label: t('secondary') },
    { id: 'tvet', label: t('tvet') },
    { id: 'preschool', label: t('preschool') },
  ];
  return (
    <section id="apply" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">{t('selectInstitutionType')}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {types.map((type) => (
            <Link
              key={type.id}
              href={`/apply/${type.id}`}
              className="group flex flex-col items-center rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm transition-colors hover:border-primary-400 hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary-50 text-primary-700 group-hover:bg-primary-100">
                <GraduationCap className="h-6 w-6" />
              </div>
              <span className="mt-3 text-sm font-medium text-gray-900 group-hover:text-primary-700">{type.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
