import type { Metadata } from 'next';

import { PageHero } from '@/components/layout/page-hero';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Product overview',
  description:
    'Explore the ProctiraERP modules: students, staff, finance, reporting, and integrations across schools, districts, and ministries.',
  alternates: { canonical: '/product' },
  openGraph: {
    title: 'ProctiraERP Product Overview',
    description: 'Modules and capabilities of the ProctiraERP platform.',
    url: '/product',
  },
};

interface FeatureDomain {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly capabilities: ReadonlyArray<string>;
}

const DOMAINS: ReadonlyArray<FeatureDomain> = [
  {
    id: 'student',
    title: 'Student lifecycle',
    summary: 'Manage every stage from admission to graduation.',
    capabilities: [
      'Admissions and enrollment',
      'Attendance tracking with biometric and offline options',
      'Assessments, grading, and report cards',
      'Transfers, promotions, and graduation',
      'Special needs and inclusion programs',
    ],
  },
  {
    id: 'staff',
    title: 'Staff and HR',
    summary: 'Workforce management for educators and administrators.',
    capabilities: [
      'Teacher and staff records',
      'Role-based access control',
      'Payroll integration',
      'Leave, training, and certification tracking',
    ],
  },
  {
    id: 'institution',
    title: 'Institutions',
    summary: 'Run schools, districts, and ministry hierarchies.',
    capabilities: [
      'Multi-tenant institution registry',
      'Board and district hierarchies',
      'Infrastructure and asset tracking',
      'Geographic and administrative zoning',
    ],
  },
  {
    id: 'finance',
    title: 'Finance and operations',
    summary: 'Track revenue, expenditure, and budget execution.',
    capabilities: [
      'Fee collection and receipts',
      'Budgeting and expenditure',
      'Vendor and procurement records',
      'Donor and grant tracking',
    ],
  },
  {
    id: 'reporting',
    title: 'Reporting and analytics',
    summary: 'Operational dashboards and policy-grade reports.',
    capabilities: [
      'Pre-built dashboards by role',
      'Census and EMIS reporting',
      'SDG indicator alignment',
      'Exportable reports (PDF, Excel, CSV, JSON)',
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations and extensibility',
    summary: 'Connect to existing systems and extend without forking.',
    capabilities: [
      'OpenAPI-documented REST endpoints',
      'Webhooks and event streams',
      'Plugin marketplace with signed bundles',
      'Tenant theming with token validation',
    ],
  },
];

/**
 * Product overview page grouped by feature domain.
 */
export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="One platform, every education workflow"
        description="ProctiraERP combines proven modules for student, staff, institution, finance, and reporting workflows with the integrations and governance you need to run education at scale."
      />

      <section className="container py-16" aria-label="Feature domains">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map((domain) => (
            <Card key={domain.id} id={domain.id}>
              <CardHeader>
                <CardTitle>{domain.title}</CardTitle>
                <CardDescription>{domain.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {domain.capabilities.map((capability) => (
                    <li key={capability} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"
                      />
                      <span>{capability}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
