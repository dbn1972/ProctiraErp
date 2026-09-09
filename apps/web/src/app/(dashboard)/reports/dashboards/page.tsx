import { redirect } from 'next/navigation';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsDashboardsAliasPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const role = Array.isArray(searchParams?.role) ? searchParams?.role[0] : searchParams?.role;
  redirect(role ? `/reports/dashboard?role=${encodeURIComponent(role)}` : '/reports/dashboard');
}
