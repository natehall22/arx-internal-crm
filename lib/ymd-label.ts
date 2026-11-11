/** Plain labels for a 'YYYY-MM-DD' calendar day (no time zone involved: the day is the day). Pure, client-safe. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Nov 23"; with `weekday` "Mon, Nov 23"; with `long` "Monday, November 23". */
export function ymdLabel(ymd: string, opts: { weekday?: boolean; long?: boolean } = {}): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7))
  const d = Number(ymd.slice(8, 10))
  if (!y || m < 1 || m > 12 || d < 1) return ymd
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (opts.long) return `${DAYS_LONG[dow]}, ${MONTHS_LONG[m - 1]} ${d}`
  return `${opts.weekday ? `${DAYS[dow]}, ` : ''}${MONTHS[m - 1]} ${d}`
}
