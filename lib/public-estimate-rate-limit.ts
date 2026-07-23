type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

function prune(now: number) {
  if (buckets.size < 5000) return
  for (const [key, bucket] of Array.from(buckets.entries())) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Simple in-memory sliding window. Adequate for casual bot abuse on a single
 * Vercel instance; pair with Turnstile for real protection.
 */
export function consumePublicEstimateRateLimit(options: {
  key: string
  limit: number
  windowMs: number
  now?: number
}): { ok: true; remaining: number } | { ok: false; retryAfterSec: number } {
  const now = options.now ?? Date.now()
  prune(now)
  const existing = buckets.get(options.key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(options.key, { count: 1, resetAt: now + options.windowMs })
    return { ok: true, remaining: options.limit - 1 }
  }
  if (existing.count >= options.limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  existing.count += 1
  return { ok: true, remaining: options.limit - existing.count }
}

/** Test helper — clears buckets between unit tests. */
export function resetPublicEstimateRateLimitForTests() {
  buckets.clear()
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}
