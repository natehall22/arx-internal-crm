/**
 * The "Email me a reset link" answer always takes the same time (its own floor; sign-in has its own, lib/login-refusal-timing.ts,
 * and is not touched). The real work (company lookup, user lookup, mail) runs after the answer, so it cannot show in the timing.
 */
export const PASSWORD_RESET_ANSWER_MS = 700

export async function padPasswordResetAnswer(startedAt: number, floorMs: number = PASSWORD_RESET_ANSWER_MS): Promise<void> {
  const wait = startedAt + floorMs - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}
