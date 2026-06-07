import { redirect } from 'next/navigation';

interface InstitutionPageProps {
  params: { id: string };
}

/**
 * Default institution detail route — redirects to the overview tab so users
 * always land on a meaningful page.
 */
export default function InstitutionPage({ params }: InstitutionPageProps) {
  redirect(`/institutions/${params.id}/overview`);
}
