/**
 * Page through a repository list until every row has been collected.
 * Replaces silent hard caps (e.g. pageSize 10000/100000) that truncated exports.
 */
export const DEFAULT_FETCH_PAGE_SIZE = 1000;

export async function collectAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ data: T[]; total: number }>,
  pageSize: number = DEFAULT_FETCH_PAGE_SIZE,
): Promise<T[]> {
  const size = Math.max(1, Math.floor(pageSize));
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const { data, total } = await fetchPage(page, size);
    all.push(...data);
    if (data.length === 0 || all.length >= total) break;
  }
  return all;
}
