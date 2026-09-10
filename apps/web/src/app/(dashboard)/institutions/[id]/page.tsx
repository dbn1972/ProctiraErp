import { redirect } from 'next/navigation';

interface InstitutionPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Default institution detail route — redirects to the overview tab so users
 * always land on a meaningful page.
 */
export default async function InstitutionPage(props: InstitutionPageProps) {
  const params = await props.params;
  redirect(`/institutions/${params.id}/overview`);
}
