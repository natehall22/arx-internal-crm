import { createHash, randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const form = await request.formData()
  const signedName = String(form.get('signedName') || '').trim()
  const consent = form.get('consent') === 'yes'
  const redirectUrl = new URL(`/comp-agreements/sign/${params.token}`, request.url)
  if (!signedName || !consent) { redirectUrl.searchParams.set('error', 'Full name and electronic-signature consent are required.'); return NextResponse.redirect(redirectUrl, { status: 303 }) }
  const admin = createServiceClient()
  const tokenHash = createHash('sha256').update(params.token).digest('hex')
  const { data: agreement } = await admin.from('employee_comp_agreements').select('id, status, token_expires_at, agreement_snapshot').eq('signing_token_hash', tokenHash).maybeSingle()
  if (!agreement || agreement.status !== 'sent' || !agreement.token_expires_at || new Date(agreement.token_expires_at).getTime() < Date.now()) { redirectUrl.searchParams.set('error', 'This signing link is invalid, expired, or already used.'); return NextResponse.redirect(redirectUrl, { status: 303 }) }
  const snapshot = agreement.agreement_snapshot as { employeeName?: string }
  if (!snapshot.employeeName || normalizeName(signedName) !== normalizeName(snapshot.employeeName)) { redirectUrl.searchParams.set('error', 'Typed signature must match the employee name shown on the agreement.'); return NextResponse.redirect(redirectUrl, { status: 303 }) }
  const signedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const signedUserAgent = request.headers.get('user-agent')
  const receiptToken = randomBytes(32).toString('base64url')
  const receiptHash = createHash('sha256').update(receiptToken).digest('hex')
  const receiptExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { data: completedId, error } = await admin.rpc('complete_employee_comp_agreement', { p_signing_token_hash: tokenHash, p_signed_name: signedName, p_signed_ip: signedIp, p_signed_user_agent: signedUserAgent, p_receipt_token_hash: receiptHash, p_receipt_expires_at: receiptExpiresAt })
  if (error || !completedId) { redirectUrl.searchParams.set('error', 'This agreement could not be signed. It may already be complete.'); return NextResponse.redirect(redirectUrl, { status: 303 }) }
  return NextResponse.redirect(new URL(`/comp-agreements/receipt/${receiptToken}`, request.url), { status: 303 })
}
