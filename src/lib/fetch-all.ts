// The database API returns at most 1,000 rows per request, silently. Lists that can grow past that
// (TNA steps, payments, Tally entries) are read page by page so nothing is quietly left out.
// `page` must build a fresh query with a stable order each time, ending in .range(from, to).
const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
}
