import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  GraduationCap,
  Phone,
  Search,
  Upload,
} from 'lucide-react';

import { DocumentTitle } from '@/components/DocumentTitle';

/**
 * Registration portal home — matches redesign/registration/home.html
 * with ProctiraERP branding.
 */
export default function RegisterHomePage(): JSX.Element {
  return (
    <>
      <DocumentTitle pageTitle="Student Registration Portal" />
      <main>
        <Hero />
        <HowItWorks />
        <Eligibility />
        <Faq />
      </main>
    </>
  );
}

function Hero(): JSX.Element {
  return (
    <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(900px_500px_at_85%_-20%,var(--color-primary-50)_0%,transparent_60%),linear-gradient(180deg,#f8fafc,white)]">
      <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.15fr_.85fr] lg:py-[72px]">
        <div>
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary-200)] bg-[var(--color-primary-50)] px-3.5 py-1.5 text-xs font-bold text-[var(--color-primary-700)]">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
            Admissions open · Academic year 2026–27
          </span>
          <h1 className="mb-4 text-[clamp(1.9rem,4.2vw,2.85rem)] font-extrabold leading-[1.12] tracking-tight">
            Enroll your child in a government school —{' '}
            <em className="not-italic text-[var(--color-primary-600)]">
              online, free, in 10&nbsp;minutes
            </em>
          </h1>
          <p className="mb-7 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
            Apply to any government school from your phone. No queues, no agent
            fees, no paperwork to photocopy. You will get updates by SMS at
            every step.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/register/apply"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--color-primary-600)] px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-primary-700)]"
            >
              Start registration
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
            <Link
              href="/track"
              className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-white px-6 text-base font-semibold text-foreground transition-colors hover:bg-slate-50"
            >
              Track application
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {['Completely free', 'Works on any phone', 'SMS updates'].map(
              (label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"
                >
                  <CheckCircle2
                    className="h-4 w-4 text-emerald-600"
                    aria-hidden="true"
                  />
                  {label}
                </span>
              ),
            )}
          </div>
        </div>

        <aside
          className="relative hidden lg:block"
          aria-hidden="true"
        >
          <span className="absolute -right-2.5 -top-4 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-md">
            Applications open this year
          </span>
          <div className="rounded-xl border border-border bg-white p-[22px] shadow-sm">
            <HeroRow
              iconBg="bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"
              icon={<FileText className="h-4 w-4" />}
              title="Application REG-A1B2C3D4"
              subtitle="Sample applicant · Class 1 · Govt. UP School"
              pill="Approved"
              pillClass="bg-emerald-50 text-emerald-700"
            />
            <HeroRow
              iconBg="bg-sky-50 text-sky-600"
              icon={<Phone className="h-4 w-4" />}
              title="SMS confirmation sent"
              subtitle="Your ward's admission status was updated."
            />
            <HeroRow
              iconBg="bg-emerald-50 text-emerald-600"
              icon={<CheckCircle2 className="h-4 w-4" />}
              title="Seat reserved"
              subtitle="Class 1 · Section assigned on admission day"
              last
            />
          </div>
        </aside>
      </div>
    </section>
  );
}

function HeroRow({
  icon,
  iconBg,
  title,
  subtitle,
  pill,
  pillClass,
  last = false,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  pill?: string;
  pillClass?: string;
  last?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex items-center gap-3 py-2.5 ${last ? 'pb-0' : 'border-b border-dashed border-border'}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${iconBg}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-sm font-semibold">{title}</b>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      {pill ? (
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${pillClass}`}
        >
          {pill}
        </span>
      ) : null}
    </div>
  );
}

function HowItWorks(): JSX.Element {
  const steps = [
    {
      n: 1,
      title: 'Fill the form',
      body: "Enter your child's details and your contact number. The form takes about 5 minutes.",
      Icon: FileText,
    },
    {
      n: 2,
      title: 'Upload documents',
      body: 'Take clear photos of the birth certificate and address proof. PDF or JPG, up to 5 MB each.',
      Icon: Upload,
    },
    {
      n: 3,
      title: 'Track status',
      body: 'You get a reference number instantly. Use it anytime to check progress — we also send SMS updates.',
      Icon: Search,
    },
  ];

  return (
    <section className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6" id="how-it-works">
      <div className="mx-auto mb-10 max-w-xl text-center">
        <h2 className="mb-2 text-3xl font-extrabold tracking-tight">
          Three simple steps
        </h2>
        <p className="text-muted-foreground">
          Keep your child&apos;s birth certificate and your address proof ready —
          that is all you need to begin.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {steps.map(({ n, title, body, Icon }) => (
          <div
            key={n}
            className="relative rounded-xl border border-border bg-white px-6 pb-6 pt-7 shadow-sm"
          >
            <span className="absolute -top-3.5 left-[22px] flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--color-primary-600)] text-sm font-extrabold text-white shadow-[0_0_0_4px_#f8fafc]">
              {n}
            </span>
            <span className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-[13px] bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mb-1.5 text-lg font-bold">{title}</h3>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Eligibility(): JSX.Element {
  const items = [
    {
      title: 'Age:',
      body: ' children who complete 6 years by 1 September 2026 can join Class 1. Older children are placed in an age-appropriate class.',
    },
    {
      title: 'Residence:',
      body: ' any family living in the catchment area. Priority is given to neighbourhood schools for primary classes.',
    },
    {
      title: 'Documents:',
      body: ' birth certificate and address proof are needed. A caste certificate is optional and only used for scholarship benefits.',
    },
    {
      title: 'No document? Apply anyway.',
      body: ' Admission cannot be denied for missing papers — the school will help you obtain them after enrollment.',
    },
  ];

  return (
    <section className="border-y border-border bg-slate-50">
      <div className="mx-auto grid max-w-[1120px] gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2.5 text-3xl font-extrabold tracking-tight">
            Who can apply?
          </h2>
          <p className="mb-6 leading-relaxed text-muted-foreground">
            Every child has a right to free education under the RTE Act 2009.
            Government schools charge no admission fee and provide free
            textbooks, uniforms, and the mid-day meal.
          </p>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
            {items.map((item) => (
              <li
                key={item.title}
                className="flex gap-3 text-base leading-snug text-muted-foreground"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <span>
                  <b className="text-foreground">{item.title}</b>
                  {item.body}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
            <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
              <Phone className="h-5 w-5" />
            </span>
            <div>
              <h3 className="mb-1 text-lg font-bold">
                Need help? Call us — it&apos;s toll-free
              </h3>
              <span className="block text-2xl font-extrabold tracking-wide text-[var(--color-primary-700)]">
                155335
              </span>
              <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                Monday to Saturday, 8 am to 8 pm. Help available in multiple
                languages. The call costs you nothing.
              </p>
            </div>
          </div>
          <div className="flex gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
            <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-amber-50 text-amber-600">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div>
              <h3 className="mb-1 text-lg font-bold">Prefer to apply in person?</h3>
              <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                Visit any school or the Block Education Office during working
                hours — staff will fill this same form with you, free of charge.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq(): JSX.Element {
  const faqs = [
    {
      q: 'Does it cost anything to apply or study?',
      a: 'No. Registration is free, admission is free, and education in government schools is free. If anyone asks you for money to "process" your application, please report it on the helpline 155335.',
    },
    {
      q: "I don't have a birth certificate for my child. Can I still apply?",
      a: 'Yes. Start the application and skip the upload. An Anganwadi record, hospital record, or a self-declaration of age is accepted temporarily.',
    },
    {
      q: 'Can I apply to more than one school?',
      a: 'Yes, you may select up to three schools in order of preference when seats are limited. Your application moves automatically if your first choice has no seats.',
    },
    {
      q: 'How long does the whole process take?',
      a: 'Document verification takes 2–3 working days. The school then reviews and confirms the seat, usually within a week. Check status anytime on Track Application.',
    },
  ];

  return (
    <section className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6" id="faq">
      <div className="mx-auto mb-10 max-w-xl text-center">
        <h2 className="mb-2 text-3xl font-extrabold tracking-tight">
          Common questions
        </h2>
        <p className="text-muted-foreground">
          Quick answers from parents who applied before you.
        </p>
      </div>
      <div className="space-y-2.5">
        {faqs.map((faq, i) => (
          <details
            key={faq.q}
            open={i === 0}
            className="rounded-xl border border-border bg-white shadow-sm open:shadow"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {faq.q}
              <ArrowRight className="ms-auto h-4 w-4 shrink-0 rotate-90 text-muted-foreground transition-transform [[open]_&]:-rotate-90" />
            </summary>
            <div className="max-w-[72ch] px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
              {faq.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
