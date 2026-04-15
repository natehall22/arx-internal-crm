import type { PostgrestError } from '@supabase/supabase-js'

/** PostgREST default max rows per request (Supabase). */
const PAGE_SIZE = 1000

/**
 * Fetch every row for a filtered query by paging `.range()` until a short page.
 */
export async function fetchSupabaseAllPages<T extends Record<string, unknown>>(
  runRange: (from: number, to: number) => Promise<{ data: T[] | null; error: PostgrestError | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await runRange(from, to)
    if (error) throw error
    const chunk = data ?? []
    if (chunk.length === 0) break
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }
  return rows
}
