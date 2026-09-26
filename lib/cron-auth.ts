import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * The one CRON_SECRET check for Vercel crons and GitHub Actions workers: 503 when the
 * secret isn't configured (so a missing env var never silently opens the endpoint), 401
 * on a wrong or missing `Authorization: Bearer <secret>`. Returns null when authorised.
 * Constant-time compare so the secret can't be recovered from response timing.
 */
export function verifyCronSecret(request: Request, jobName?: string): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error(`CRON_SECRET env var not set — ${jobName ?? 'cron endpoint'} will not run`)
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${cronSecret}`)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
