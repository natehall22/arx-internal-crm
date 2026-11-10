/**
 * A column isn't there yet (migration not applied): Postgres "undefined column" on a read (42703) or PostgREST
 * "column not in the schema cache" on a write (PGRST204) naming that column. Anything else is a real error.
 * Client-safe (no imports).
 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false
  return (error.code === '42703' || error.code === 'PGRST204') && String(error.message ?? '').includes(column)
}
