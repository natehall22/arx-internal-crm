/** Min time between successful inspection scheduling submissions (reduces duplicate bookings). */
export const INSPECTION_SUBMIT_COOLDOWN_MS = 30_000

const STORAGE_KEY = 'canvass_inspection_submit_at'

export function getInspectionSubmitCooldownRemainingMs(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const last = parseInt(raw, 10)
    if (Number.isNaN(last)) return 0
    const elapsed = Date.now() - last
    return Math.max(0, INSPECTION_SUBMIT_COOLDOWN_MS - elapsed)
  } catch {
    return 0
  }
}

/** Call only after /api/canvass/lead succeeds with schedule_inspection. */
export function recordSuccessfulInspectionSubmit(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // ignore quota / private mode
  }
}
