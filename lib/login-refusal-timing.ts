/**
 * Every refused sign-in (wrong password, unknown company address, account in another company, disabled) answers at
 * the SAME target time, so no path can be told from another by timing. The target is relative: at least the floor,
 * and above the slowest refusal path actually measured on this instance (its natural, un-padded time, kept as a
 * slowly decaying high-water mark, capped), plus jitter. Successful sign-ins are not delayed.
 */
const LOGIN_FAILURE_FLOOR_MS = 1200
const LOGIN_FAILURE_CAP_MS = 6000
const LOGIN_FAILURE_JITTER_MS = 250
const LOGIN_SLOW_PATH_MARGIN = 1.25
let slowestRefusalMs = 0

/** Target for a refusal whose own work took `naturalMs`. */
export function refusalTargetMs(naturalMs: number): number {
  slowestRefusalMs = Math.min(LOGIN_FAILURE_CAP_MS, Math.max(naturalMs, slowestRefusalMs * 0.995))
  return Math.min(LOGIN_FAILURE_CAP_MS, Math.max(LOGIN_FAILURE_FLOOR_MS, slowestRefusalMs * LOGIN_SLOW_PATH_MARGIN))
}

export async function waitForFailureTarget(startedAt: number): Promise<void> {
  const natural = Date.now() - startedAt
  const target = startedAt + refusalTargetMs(natural) + Math.floor(Math.random() * LOGIN_FAILURE_JITTER_MS)
  const wait = target - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

export function __resetLoginRefusalTimingForTests(): void {
  slowestRefusalMs = 0
}
