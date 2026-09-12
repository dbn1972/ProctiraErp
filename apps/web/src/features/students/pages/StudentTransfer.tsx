/**
 * StudentTransfer — federated bridge for `/app/students/:id/transfer`.
 *
 * App Router owns the real transfer workflow at `/students/[id]/transfer`.
 */
import { useParams } from 'react-router-dom';

function RedirectTo({ href }: { href: string }) {
  if (typeof window !== 'undefined') window.location.replace(href);
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 p-6 text-muted-foreground"
      data-testid="student-transfer-redirect"
    >
      <p>Opening the transfer workspace…</p>
      <p>
        <a href={href} className="font-medium text-foreground underline-offset-2 hover:underline">
          Continue to transfer
        </a>
      </p>
    </div>
  );
}

export default function StudentTransfer() {
  const { id } = useParams<{ id: string }>();
  const href = id ? `/students/${id}/transfer` : '/students';
  return <RedirectTo href={href} />;
}
