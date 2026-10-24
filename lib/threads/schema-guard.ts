/**
 * The thread/notes code reads and writes columns added by migration 202610270010. If the code is ever live before that
 * migration (a mis-ordered deploy), a missing column or table must produce ONE clear, retryable answer — never a crash,
 * a half-written note or a generic "Failed" — and must not touch the data. Deploy order is still: migration first.
 */
export const SCHEMA_PENDING_MESSAGE = 'Notes are being upgraded. Nothing was lost; try again in a minute.'

/** Postgres undefined_column / undefined_table, or PostgREST's schema-cache misses (PGRST204 column, PGRST205 table). */
export function isThreadSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return true
  return typeof message === 'string' && /(column|relation|table).*(does not exist|not found)|could not find the .* (column|table)|schema cache/i.test(message)
}

export class ThreadSchemaPendingError extends Error {
  constructor() {
    super(SCHEMA_PENDING_MESSAGE)
    this.name = 'ThreadSchemaPendingError'
  }
}
