import type { Metadata } from 'next';
import {
  AlertTriangle,
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { PageHero } from '@/components/layout/page-hero';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How ProctiraERP protects student, staff, and institutional data: encryption, audit logging, RBAC, multi-tenant isolation, and break-glass controls.',
  alternates: { canonical: '/security' },
  openGraph: {
    title: 'ProctiraERP Security',
    description: 'Security disclosures for the ProctiraERP platform.',
    url: '/security',
  },
};

const CONTROLS = [
  {
    icon: Lock,
    title: 'Encryption everywhere',
    body: 'TLS 1.2+ in transit and AES-256 at rest. Centralized secret management with rotation and least-privilege access.',
  },
  {
    icon: ShieldCheck,
    title: 'Tenant isolation',
    body: 'Strong logical isolation per tenant with row- and connection-level enforcement. Cross-tenant access is impossible from application code.',
  },
  {
    icon: Users,
    title: 'Role-based access control',
    body: 'Fine-grained permissions per module and field. RBAC enforced at the API gateway and service layers, not just the UI.',
  },
  {
    icon: ScrollText,
    title: 'Immutable audit logging',
    body: 'Every privileged action is recorded — auth, permission changes, exports, deletions, plugin lifecycle, and break-glass access.',
  },
  {
    icon: KeyRound,
    title: 'Strong authentication',
    body: 'Password policy, MFA, session controls, anomaly detection support, and SSO via OIDC and SAML.',
  },
  {
    icon: AlertTriangle,
    title: 'Break-glass with accountability',
    body: 'Time-boxed, approved support access. Sessions are recorded, reviewed post-hoc, and visible to tenant admins.',
  },
];

const PROCESS = [
  'Secure SDLC with mandatory code review and dependency scanning',
  'Pinned dependencies and a documented vulnerability remediation process',
  'Threat-model reviews for every privileged surface',
  'Continuous backup verification and restore drills',
  'Coordinated vulnerability disclosure program',
];

/**
 * Security disclosures page.
 *
 * Documents the platform's baseline controls, audit posture, and disclosure
 * process. Mirrors the platform charter security requirements.
 */
export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Trust"
        title="Security at the core"
        description="ProctiraERP handles some of the most sensitive data a society holds — student records. Here is how we protect it."
      />

      <section className="container py-16" aria-labelledby="controls-heading">
        <h2
          id="controls-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          Baseline controls
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((control) => {
            const Icon = control.icon;
            return (
              <Card key={control.title}>
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <CardTitle className="mt-4">{control.title}</CardTitle>
                  <CardDescription>{control.body}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className="border-t border-border bg-secondary/30 py-16"
        aria-labelledby="process-heading"
      >
        <div className="container">
          <h2
            id="process-heading"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            Process and posture
          </h2>
          <ul className="mt-6 space-y-3 text-muted-foreground">
            {PROCESS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container py-16" aria-labelledby="report-heading">
        <h2
          id="report-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          Report a vulnerability
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Found something? We appreciate responsible disclosure. Email{' '}
          <a
            className="font-medium text-primary hover:underline"
            href="mailto:security@proctira.org"
          >
            security@proctira.org
          </a>{' '}
          with reproduction steps and impact details. We will acknowledge
          within two business days.
        </p>
      </section>
    </>
  );
}
