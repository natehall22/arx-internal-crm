/* eslint-disable no-restricted-properties -- calendar days (YYYY-MM-DD) are printed as that exact day (UTC), never shifted by a zone; formatDate would move them */
/** Plain-words formatting for the customer portal (client-safe). Day strings (YYYY-MM-DD) are shown as that calendar day, never shifted by a time zone. */
export const money = (cents: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

export function dayLabel(v: string | null | undefined): string {
  if (!v) return ''
  const ymd = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null
  const d = ymd ? new Date(`${ymd}T12:00:00Z`) : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: ymd ? 'UTC' : undefined })
}

export function shortDate(v: string | null | undefined): string {
  if (!v) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'UTC' : undefined })
}
