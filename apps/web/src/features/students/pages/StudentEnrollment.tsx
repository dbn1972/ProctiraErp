/**
 * StudentEnrollment — federated bridge for `/app/students/enroll`.
 *
 * Real enrollment UX lives under the App Router (`/students/enroll` hub and
 * `/students/[id]/enroll`). This component hard-navigates so the federated
 * shell does not leave a dead-end placeholder (P0-04).
 */
function RedirectTo({ href }: { href: string }) {
  if (typeof window !== 'undefined') window.location.replace(href);
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 p-6 text-muted-foreground"
      data-testid="student-enrollment-redirect"
    >
      <p>Opening the enrollment workspace…</p>
      <p>
        <a href={href} className="font-medium text-foreground underline-offset-2 hover:underline">
          Continue to enroll
        </a>
      </p>
    </div>
  );
}

export default function StudentEnrollment() {
  return <RedirectTo href="/students/enroll" />;
}
