export interface WaitlistApplicant {
  id: string;
  firstName: string;
  lastName: string;
  trackingNumber: string;
}

/** Applicant name and application number for a waitlist row. */
export function waitlistApplicantLabel(
  applicationId: string,
  applications: WaitlistApplicant[],
): string {
  const match = applications.find((row) => row.id === applicationId);
  if (!match) return 'Unknown applicant';
  const name = `${match.firstName} ${match.lastName}`.trim();
  if (name && match.trackingNumber) return `${name} · ${match.trackingNumber}`;
  return name || match.trackingNumber || 'Unknown applicant';
}
