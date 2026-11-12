/**
 * True when a Postgres/PostgREST error says a specific column does not exist yet (migration not applied):
 * 42703 (undefined_column) or PGRST204 (column not in the schema cache), and the message names the column.
 * Lets a writer retry without a new column so a deploy-order slip cannot stop a live flow.
 */
export function isMissingColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  column: string
): boolean {
  if (!error) return false
  const code = error.code ?? ''
  if (code !== '42703' && code !== 'PGRST204') return false
  return (error.message ?? '').includes(column)
}
