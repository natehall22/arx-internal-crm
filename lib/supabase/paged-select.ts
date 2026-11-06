/**
 * Read every row of a query past PostgREST's page cap (1,000 rows), and run `.in()` filters in chunks that stay under
 * the request-URL limit. Moved here from lib/data-health.ts (unchanged) so other batch loaders share it.
 */
export const PAGE_SIZE = 1000
export const IN_CHUNK = 200

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>

export async function selectAll<T>(build: (from: number, to: number) => Result): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = (data as T[] | null) ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

export async function selectIn<T>(ids: string[], build: (chunk: string[]) => Result): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await build(ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    out.push(...(((data as T[] | null) ?? []) as T[]))
  }
  return out
}
