import { NextRequest, NextResponse } from 'next/server'

import {
  COMPANY_CODE_HEADER,
  RESOLVED_LOOKUPS_HEADER,
  fenceAllowsOrg,
  resolveCompanyFence,
  verifyResolvedLookups,
} from '@/lib/company-host'
import { waitForFailureTarget } from '@/lib/login-refusal-timing'
import { sendPasswordResetEmail } from '@/lib/password-reset-email'
import { clientIpFromRequest, consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const SAME_ANSWER = { ok: true, message: 'If that email belongs to an account here, a reset link is on its way.' }
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * "Email me a reset link" on the sign-in page. Always the same answer (and the same floor time as a refused sign-in), whether
 * or not the email exists, belongs to another company, is disabled, was rate-limited or failed to send. Only an account of
 * THIS address's company is ever mailed; the link is built by the one reset implementation (lib/password-reset-email.ts)
 * from that company's own address. Limits: 5 requests / 15 min per IP and 3 / hour per email (in-memory, per instance).
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const answer = async () => {
    await waitForFailureTarget(startedAt)
    return NextResponse.json(SAME_ANSWER, { headers: { 'cache-control': 'no-store' } })
  }

  let email = ''
  try {
    const body = await req.json()
    email = String(body?.email ?? '').trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: 'Enter your email.' }, { status: 400 })
  }
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 })
  }

  const ipLimit = consumePublicEstimateRateLimit({ key: `pwreset:ip:${clientIpFromRequest(req)}`, limit: 5, windowMs: 15 * 60_000 })
  const emailLimit = consumePublicEstimateRateLimit({ key: `pwreset:email:${email}`, limit: 3, windowMs: 60 * 60_000 })
  if (!ipLimit.ok || !emailLimit.ok) return await answer()

  try {
    const host = req.headers.get('host') ?? req.nextUrl.host
    const resolved = await verifyResolvedLookups(req.headers.get(RESOLVED_LOOKUPS_HEADER), host, req.headers.get(COMPANY_CODE_HEADER))
    const fence = await resolveCompanyFence({ host, resolved: resolved ? { host: resolved.host } : null })
    if (fence.kind === 'closed') return await answer()

    const admin = createServiceClient()
    const { data: rows } = await admin
      .from('users')
      .select('org_id, email, active')
      .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .limit(5)
    const person = (rows ?? []).find(
      (r) => String(r.email ?? '').toLowerCase() === email && r.active !== false && r.org_id && fenceAllowsOrg(fence, r.org_id as string)
    )
    if (person) {
      await sendPasswordResetEmail(admin, {
        orgId: person.org_id as string,
        email: String(person.email),
        intro: 'You asked for a link to reset your password.',
      })
    }
  } catch (error) {
    console.error('forgot-password failed:', error instanceof Error ? error.message : error)
  }
  return await answer()
}
