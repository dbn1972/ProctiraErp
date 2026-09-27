import { redirect } from 'next/navigation';

interface InstitutionPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Fallback when a request reaches this segment without middleware.
 * The authoritative hop is `institutionBareDetailRedirect` in middleware,
 * which 307s to `/overview` before this layout fetches the institution.
 * A `redirect()` here still waits on that layout, so it is not the primary path.
 */
export default async function InstitutionPage(props: InstitutionPageProps) {
  const params = await props.params;
  redirect(`/institutions/${params.id}/overview`);
}
