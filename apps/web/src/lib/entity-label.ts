/**
 * Human-readable entity labels for SIS UIs (G-302).
 * Prefer "CODE · Name"; never surface a raw UUID as the primary label.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EntityLabelOption = {
  id: string;
  label: string;
  searchText?: string;
};

export function isUuidLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return UUID_RE.test(value.trim());
}

/** Build "CODE · Name" (or name-only / code-only). */
export function formatCodeNameLabel(
  code: string | null | undefined,
  name: string | null | undefined,
): string {
  const c = (code ?? '').trim();
  const n = (name ?? '').trim();
  if (c && n) return `${c} · ${n}`;
  if (n) return n;
  if (c) return c;
  return '';
}

/** Person display: "First Last" with optional code/admission prefix. */
export function formatPersonLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  code?: string | null,
): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return formatCodeNameLabel(code, name || null);
}

/**
 * Resolve a stored id to a human label from an options map.
 * Falls back to a truncated id marker — never the full UUID as the sole label.
 */
export function resolveEntityLabel(
  id: string | null | undefined,
  labels: Map<string, string> | Record<string, string>,
  fallbackPrefix = 'Record',
): string {
  if (!id) return '—';
  const map = labels instanceof Map ? labels : new Map(Object.entries(labels));
  const hit = map.get(id);
  if (hit && hit.trim()) return hit;
  if (isUuidLike(id)) return `${fallbackPrefix} ${id.slice(0, 8)}`;
  return id;
}

export function toLabelMap(options: EntityLabelOption[]): Map<string, string> {
  return new Map(options.map((o) => [o.id, o.label]));
}
