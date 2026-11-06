/** PostgREST default max rows per request (Supabase). */
const PAGE_SIZE = 1000
/** `.in()` lists are chunked so the request URL stays under the limit. */
export const IN_CHUNK = 200

type QueryError = { message: string }
type PageResult<T> = PromiseLike<{ data: T[] | null | unknown; error: QueryError | null }>

/** A query error as an Error (the real client already throws Error subclasses; plain `{ message }` objects are wrapped). */
function asError(error: QueryError): Error {
  return error instanceof Error ? error : Object.assign(new Error(error.message), error)
}

/**
 * Fetch every row for a filtered query by paging `.range()` until a short page. The ONE pager (data health, catch-up,
 * reporting, payroll export … all read through it).
 */
export async function fetchSupabaseAllPages<T>(runRange: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await runRange(from, to)
    if (error) throw asError(error)
    const chunk = ((data as T[] | null) ?? []) as T[]
    if (chunk.length === 0) break
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }
  return rows
}

/** Run an `.in(ids)` query in chunks of {@link IN_CHUNK} and concatenate the rows. */
export async function selectIn<T>(ids: string[], build: (chunk: string[]) => PageResult<T>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await build(ids.slice(i, i + IN_CHUNK))
    if (error) throw asError(error)
    out.push(...(((data as T[] | null) ?? []) as T[]))
  }
  return out
}
