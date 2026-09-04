'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ClipboardCopy,
  FileCheck2,
  Phone,
} from 'lucide-react';

import { Alert, AlertDescription, Button } from '@proctira/ui/components';

/**
 * Success page — redesign/registration/apply-success.html.
 * Reads tracking number from query `ref` or sessionStorage.
 */
export function SuccessView(): JSX.Element {
  const searchParams = useSearchParams();
  const [ref, setRef] = useState<string | null>(null);
  const [school, setSchool] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [applicant, setApplicant] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fromQuery = searchParams.get('ref');
    const fromStorage =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('registration:lastTrackingNumber')
        : null;
    setRef(fromQuery || fromStorage);
    setSchool(sessionStorage.getItem('registration:lastSchool'));
    setPhone(sessionStorage.getItem('registration:lastPhone'));
    setApplicant(sessionStorage.getItem('registration:lastApplicant'));
  }, [searchParams]);

  function handleCopy() {
    if (!ref) return;
    void navigator.clipboard.writeText(ref).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto w-full max-w-[620px] px-4 py-12 sm:px-6 pb-14">
      <div className="mb-6 text-center">
        <div
          className="mx-auto mb-5 flex h-[84px] w-[84px] items-center justify-center rounded-full bg-emerald-50 shadow-[0_0_0_10px_rgba(16,185,129,0.07)]"
          aria-hidden="true"
        >
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight">
          Application submitted
        </h1>
        <p className="mx-auto max-w-[46ch] text-base leading-relaxed text-muted-foreground">
          {applicant ? (
            <>
              {applicant}&apos;s application
              {school ? (
                <>
                  {' '}
                  to <strong className="text-foreground">{school}</strong>
                </>
              ) : null}{' '}
              has been received.
            </>
          ) : (
            'Your application has been received.'
          )}
          {phone ? (
            <>
              {' '}
              We have sent a confirmation SMS to <strong className="text-foreground">{phone}</strong>.
            </>
          ) : null}
        </p>

        {ref ? (
          <>
            <div className="mt-5 inline-flex items-center gap-2.5 rounded-md border border-dashed border-border bg-slate-50 px-4 py-2.5">
              <span className="font-mono text-lg font-medium tracking-wide">
                {ref}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Save this reference number — you will need it to track the
              application.
            </p>
          </>
        ) : (
          <Alert className="mt-5 text-start" variant="warning">
            <AlertDescription>
              Your application was submitted, but the tracking number is not
              available in this browser session. Check your SMS for the
              reference, or contact the helpline.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="mb-8 flex flex-wrap justify-center gap-2.5">
        <Button asChild size="lg">
          <Link href={ref ? `/track?ref=${encodeURIComponent(ref)}` : '/track'}>
            Track application
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/register">Back to portal</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h3 className="font-bold">What happens next</h3>
        </div>
        <ul className="space-y-5 p-5">
          <TimelineItem
            icon={<FileCheck2 className="h-4 w-4" />}
            brand
            title="Document verification"
            body="The education office checks your uploads — usually 2–3 working days. If anything is unclear, they will call you."
          />
          <TimelineItem
            icon={<Building2 className="h-4 w-4" />}
            title="School review & seat confirmation"
            body="The head teacher confirms the seat based on availability and distance priority."
          />
          <TimelineItem
            icon={<Phone className="h-4 w-4" />}
            title="SMS notification with admission date"
            body="You will get the final decision and admission day details by SMS. Carry the original documents on that day."
          />
        </ul>
      </div>

      <Alert className="mt-4">
        <AlertDescription>
          <b>Questions?</b> Call the toll-free helpline 155335 (Mon–Sat, 8 am–8
          pm) and keep your reference number ready.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function TimelineItem({
  icon,
  title,
  body,
  brand,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  brand?: boolean;
}): JSX.Element {
  return (
    <li className="flex gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          brand
            ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
            : 'bg-slate-100 text-slate-600'
        }`}
      >
        {icon}
      </span>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{body}</div>
      </div>
    </li>
  );
}
