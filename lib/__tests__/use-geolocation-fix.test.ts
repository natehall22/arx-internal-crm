import { isUsableFix, MAX_FIX_ACCURACY_M, MAX_FIX_AGE_MS } from '@/app/(canvass-app)/canvass/lib/useGeolocation'

describe('isUsableFix', () => {
  const now = 1_000_000
  it('accepts a fresh, accurate fix', () => expect(isUsableFix({ accuracy: 10, timestamp: now - 1000 }, now)).toBe(true))
  it('rejects a fix older than 30s', () => expect(isUsableFix({ accuracy: 10, timestamp: now - MAX_FIX_AGE_MS - 1 }, now)).toBe(false))
  it('rejects accuracy worse than 50m', () => expect(isUsableFix({ accuracy: MAX_FIX_ACCURACY_M + 1, timestamp: now }, now)).toBe(false))
  it('rejects no fix', () => expect(isUsableFix(null, now)).toBe(false))
})
