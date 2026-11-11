/**
 * A column isn't there yet (migration not applied): Postgres "undefined column" on a read (42703) or PostgREST
 * "column not in the schema cache" on a write (PGRST204) naming that column. Anything else is a real error.
 * Client-safe (no imports).
 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false
  return (error.code === '42703' || error.code === 'PGRST204') && String(error.message ?? '').includes(column)
}

/**
 * The table isn't there yet (migration not applied): Postgres "undefined table" (42P01) or PostgREST "table not in the
 * schema cache" (PGRST205). Older local copies of this check exist (payroll-*, org-trades, job-run-sheet,
 * threads/schema-guard); move them here when touched.
 */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205')
}
