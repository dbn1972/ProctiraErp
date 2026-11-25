/**
 * PRC-M629 (owner rule DR47): events handed to plugin handlers carry ids and
 * non-personal attributes only — never names, contact details, PHI or
 * financial details. A plugin that needs more calls the API under its own
 * authorised scope.
 *
 * `minimiseEventData` is an allow-list, so an unknown key is dropped rather
 * than passed through:
 * - id keys (`id`, `*Id`, `*_id`) with a string value, and id lists
 *   (`*Ids`, `*_ids`) of strings;
 * - the attribute keys in {@link NON_PERSONAL_ATTRIBUTES} with a scalar value
 *   (or, for `changedFields`, a list of field names).
 * Strings are cut to {@link MAX_STRING} characters and lists to {@link MAX_ITEMS}.
 */
export const MAX_STRING = 128;
export const MAX_ITEMS = 100;

/** Attribute keys that describe the event, not the person. */
export const NON_PERSONAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'status',
  'previousStatus',
  'newStatus',
  'fromStatus',
  'toStatus',
  'state',
  'type',
  'kind',
  'action',
  'category',
  'source',
  'format',
  'version',
  'academicYear',
  'term',
  'count',
  'total',
  'changedFields',
]);

const ID_KEY = /^(id|.+Id|.+_id)$/;
const ID_LIST_KEY = /^(.+Ids|.+_ids)$/;

function boundedString(value: string): string {
  return value.slice(0, MAX_STRING);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === 'string')
    .slice(0, MAX_ITEMS)
    .map(boundedString);
}

export function minimiseEventData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (ID_KEY.test(key)) {
      if (typeof value === 'string') out[key] = boundedString(value);
      continue;
    }
    if (ID_LIST_KEY.test(key)) {
      const list = stringList(value);
      if (list) out[key] = list;
      continue;
    }
    if (!NON_PERSONAL_ATTRIBUTES.has(key)) continue;
    if (key === 'changedFields') {
      const list = stringList(value);
      if (list) out[key] = list;
      continue;
    }
    if (typeof value === 'string') out[key] = boundedString(value);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
