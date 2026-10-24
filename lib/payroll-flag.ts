/**
 * PAYROLL_PAY_WEEK_ENABLED (server env, default OFF). While off, the new payroll screens — "Pay this week", the atomic Approve, "My pay" and
 * their APIs — are not reachable, and payroll runs exactly as it did before this release: the old /admin/payroll hub, Pay periods & lock,
 * Weekly worksheet, Consultant statements and hours pages (restored from main) with the old lock. The release's payroll migrations are
 * additive tables/columns and writer guards that nothing reads while this is off. Turn it on only after the Codex re-review and the
 * two-week side-by-side with the paid-outside numbers match to the cent. Changing it needs a redeploy (next.config redirects read it at build).
 */
export function isPayWeekEnabled(): boolean {
  return String(process.env.PAYROLL_PAY_WEEK_ENABLED ?? '').toLowerCase().trim() === 'true'
}
