import { isMissingColumn } from '@/lib/supabase/errors'

/**
 * Deploy-order safety for private notes (migration 202612010010 adds `activities.visible_user_ids`). EVERY reader that selects
 * that column goes through here: when the column is not there yet, the same select is re-run without it, so nothing breaks and a
 * private row (none can exist before the migration) would read as owners-only. Deploy order is still: migration first.
 */
export const VISIBLE_COL = 'visible_user_ids'

export function withoutVisibleCol(cols: string): string {
  return cols.split(',').map((c) => c.trim()).filter((c) => c && c !== VISIBLE_COL).join(', ')
}

// The column list is a runtime string, so the query builder cannot type the rows: callers cast `data` to their own row type.
type Res = { data: any; error: { code?: string; message?: string } | null }

export async function selectWithVisibleCol(cols: string, run: (cols: string) => PromiseLike<Res>): Promise<Res> {
  const first = await run(cols)
  if (first.error && isMissingColumn(first.error, VISIBLE_COL)) return run(withoutVisibleCol(cols))
  return first
}
