/**
 * Runs `fn` over `items` with at most `limit` calls in flight and returns the
 * results in input order (PRC-M097). Used by server pages that must resolve
 * labels for a handful of ids the list endpoints did not return, so the page
 * does not issue one sequential gateway round-trip per row.
 *
 * Duplicate items are the caller's concern; dedupe before calling.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** Default in-flight cap for label lookups against the gateway. */
export const LOOKUP_CONCURRENCY = 8;
