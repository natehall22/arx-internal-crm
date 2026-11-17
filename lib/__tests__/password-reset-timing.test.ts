import { padPasswordResetAnswer, PASSWORD_RESET_ANSWER_MS } from '@/lib/password-reset-timing'

test('pads to its own fixed floor, regardless of how long the work took', async () => {
  jest.useFakeTimers()
  try {
    const t0 = Date.now()
    let done = false
    const p = padPasswordResetAnswer(t0).then(() => { done = true })
    await jest.advanceTimersByTimeAsync(PASSWORD_RESET_ANSWER_MS - 1)
    expect(done).toBe(false)
    await jest.advanceTimersByTimeAsync(2)
    await p
    expect(done).toBe(true)
    // already past the floor: no extra wait
    await padPasswordResetAnswer(Date.now() - PASSWORD_RESET_ANSWER_MS - 5)
  } finally { jest.useRealTimers() }
})
