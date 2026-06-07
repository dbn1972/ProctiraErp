import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GraduationCap, FileText, Search, Upload, CheckCircle2, ArrowRight } from 'lucide-react';
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
    <section className="relative overflow-hidden border-b border-gray-200 bg-gradient-to-b from-primary-50/60 to-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-40 h-[480px] w-[480px] rounded-full bg-primary-100/50 blur-3xl"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-xs font-bold text-primary-700">
              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              {t('open')}
            </span>
            <h1 className="text-3xl font-extrabold leading-[1.12] tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-600 sm:text-lg">
              {t('heroSubtitle')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="#apply"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary-600 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {t('applyCta')}
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link
                href="/track"
                className="btn-secondary h-12 px-6 text-base font-semibold"
              >
                {t('trackCta')}
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
              {[t('step1Desc'), t('step3Desc'), t('step4Desc')].map((label) => (
                <span key={label} className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <CheckCircle2 className="h-4 w-4 text-accent-600" aria-hidden="true" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="card p-6">
              <FeatureRow
                icon={<GraduationCap className="h-5 w-5" />}
                tone="primary"
                title={t('step2Title')}
                desc={t('step2Desc')}
              />
              <FeatureRow
                icon={<Upload className="h-5 w-5" />}
                tone="accent"
                title={t('step3Title')}
                desc={t('step3Desc')}
              />
              <FeatureRow
                icon={<CheckCircle2 className="h-5 w-5" />}
                tone="primary"
                title={t('step4Title')}
                desc={t('step4Desc')}
                last
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureRow({
  icon,
  tone,
  title,
  desc,
  last,
}: {
  icon: React.ReactNode;
  tone: 'primary' | 'accent';
  title: string;
  desc: string;
  last?: boolean;
}) {
  const toneClass =
    tone === 'accent' ? 'bg-accent-50 text-accent-600' : 'bg-primary-50 text-primary-600';
  return (
    <div
      className={`flex items-center gap-3 py-3 ${last ? '' : 'border-b border-dashed border-gray-200'}`}
    >
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="truncate text-xs text-gray-500">{desc}</p>
      </div>
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
        <h2 className="text-center text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          {t('stepsTitle')}
        </h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.n} className="card relative pt-8">
              <span className="absolute -top-3.5 left-6 flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-sm font-extrabold text-white ring-4 ring-gray-50">
                {step.n}
              </span>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                {step.icon}
              </div>
              <h3 className="mt-4 text-base font-bold text-gray-900">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{step.desc}</p>
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
        <h2 className="text-center text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          {t('selectInstitutionType')}
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {types.map((type) => (
            <Link
              key={type.id}
              href={`/apply/${type.id}`}
              className="group flex flex-col items-center rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 transition-colors group-hover:bg-primary-100">
                <GraduationCap className="h-6 w-6" />
              </div>
              <span className="mt-3 text-sm font-semibold text-gray-900 group-hover:text-primary-700">
                {type.label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
