import { Badge } from './badge';

/** Maps a status string to a badge variant. */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const variant = mapVariant(status);
  return (
    <Badge variant={variant} className={className}>
      {humanize(status)}
    </Badge>
  );
}

function mapVariant(
  status: string,
): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' | 'info' {
  const s = status.toLowerCase();
  if (s.includes('healthy') || s === 'active' || s === 'approved') return 'success';
  if (s === 'pending' || s.startsWith('pending') || s === 'submitted' || s === 'in_review' || s === 'provisioning' || s === 'degraded') {
    return 'warning';
  }
  if (s === 'down' || s === 'revoked' || s === 'rejected' || s === 'denied' || s === 'failure') {
    return 'destructive';
  }
  if (s === 'expired' || s === 'archived' || s === 'disabled' || s === 'decommissioning' || s === 'suspended') {
    return 'secondary';
  }
  return 'info';
}

function humanize(status: string): string {
  return status
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
