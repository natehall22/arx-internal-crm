import { createHash, randomBytes, randomUUID } from 'crypto'
import nodemailer from 'nodemailer'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { EMPLOYEE_AGREEMENT_TEMPLATES, isEmployeeAgreementKey, type EmployeeAgreementKey } from '@/lib/employee-comp-agreements'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const isValidIsoDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
type ScopeProfile = { role: string; custom_role_id?: string | null; team_id?: string | null; region_id?: string | null }
type ScopeTarget = { team_id?: string | null; region_id?: string | null }

async function canManageTarget(admin: ReturnType<typeof createServiceClient>, userId: string, profile: ScopeProfile, target: ScopeTarget) {
  if (isOrgSuperuserRoleSlug(profile.role)) return true
  const effective = await resolveEffectivePermissionNames(admin, userId, profile)
  if (effective.fullAccess || effective.permissionNames.has('users:manage_all')) return true
  if (effective.permissionNames.has('users:manage_region') && profile.region_id && profile.region_id === target.region_id) return true
  return Boolean(effective.permissionNames.has('users:manage_team') && profile.team_id && profile.team_id === target.team_id)
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (message === 'Account disabled') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  console.error('employee agreements API error', error)
  return NextResponse.json({ error: 'Unable to process compensation agreement' }, { status: 500 })
}

async function sendAgreementEmail(input: { to: string; name: string; roleName: string; effectiveDate: string; token: string }) {
  if (!process.env.SMTP_HOST) throw new Error('smtp_not_configured')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  if (!appUrl) throw new Error('app_url_not_configured')
  const url = `${appUrl}/comp-agreements/sign/${input.token}`
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587', 10), secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 60_000,
  })
  await transport.sendMail({
    from: process.env.SMTP_FROM || 'info@arxroofing.com', to: input.to,
    subject: `ARX ${input.roleName} compensation agreement - signature requested`,
    text: `Hi ${input.name}, please review and sign your ${input.roleName} compensation agreement effective ${input.effectiveDate}: ${url}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px"><h2>Compensation agreement ready for signature</h2><p>Hi ${escapeHtml(input.name)},</p><p>Your hiring manager has signed your <strong>${escapeHtml(input.roleName)}</strong> compensation agreement effective ${escapeHtml(input.effectiveDate)}.</p><p><a href="${url}" style="display:inline-block;background:#116530;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Review and sign agreement</a></p><p style="color:#6b7280;font-size:12px">This secure link expires in 14 days.</p></div>`,
  })
}

async function claimAndSend(admin: ReturnType<typeof createServiceClient>, input: { agreementId: string; actorId: string; actorName: string | null; actorEmail: string | null; eventType: 'send_accepted' | 'resent' }) {
  const token = randomBytes(32).toString('base64url')
  const attemptId = randomUUID()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: claimed, error: claimError } = await admin.rpc('claim_employee_agreement_send', { p_agreement_id: input.agreementId, p_attempt_id: attemptId, p_token_hash: hashToken(token), p_token_expires_at: expiresAt })
  if (claimError) throw claimError
  if (!claimed) return { claimed: false as const }
  try {
    const snapshot = claimed.agreement_snapshot as { employeeEmail?: string; employeeName?: string; effectiveDate?: string }
    const agreementKey = claimed.agreement_key
    if (!isEmployeeAgreementKey(agreementKey) || !snapshot.employeeEmail || !snapshot.employeeName || !snapshot.effectiveDate) throw new Error('invalid_agreement_snapshot')
    await sendAgreementEmail({ to: snapshot.employeeEmail, name: snapshot.employeeName, roleName: EMPLOYEE_AGREEMENT_TEMPLATES[agreementKey].roleName, effectiveDate: snapshot.effectiveDate, token })
  } catch (mailError) {
    console.error('employee agreement send failed', mailError)
    const { error: failureError } = await admin.rpc('fail_employee_agreement_send', { p_agreement_id: input.agreementId, p_attempt_id: attemptId, p_actor_user_id: input.actorId, p_actor_name: input.actorName, p_actor_email: input.actorEmail })
    if (failureError) console.error('employee agreement send failure finalization failed', failureError)
    throw new Error('delivery_failed')
  }
  const { data: finalized, error: finalizeError } = await admin.rpc('finalize_employee_agreement_send', { p_agreement_id: input.agreementId, p_attempt_id: attemptId, p_event_type: input.eventType, p_actor_user_id: input.actorId, p_actor_name: input.actorName, p_actor_email: input.actorEmail })
  if (finalizeError || !finalized) {
    console.error('employee agreement was emailed but CRM finalization failed', finalizeError)
    throw new Error('send_finalize_failed')
  }
  return { claimed: true as const }
}

export async function GET(request: NextRequest) {
  try {
    const { authUser, profile } = await requireAuthApi()
    const userId = request.nextUrl.searchParams.get('userId')
    const agreementId = request.nextUrl.searchParams.get('agreementId')
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    const admin = createServiceClient()
    const { data: target } = await admin.from('users').select('id, team_id, region_id').eq('id', userId).eq('org_id', profile.org_id).maybeSingle()
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (!(await canManageTarget(admin, authUser.id, profile, target))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (agreementId) {
      const { data: agreement, error } = await admin.from('employee_comp_agreements').select('id, agreement_key, agreement_version, agreement_snapshot, agreement_content_hash, status, effective_date, manager_signed_name, manager_signed_at, sent_at, sent_to_email, rep_signed_name, rep_signed_at').eq('id', agreementId).eq('org_id', profile.org_id).eq('user_id', userId).maybeSingle()
      if (error) throw error
      if (!agreement) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 })
      const { data: events, error: eventsError } = await admin.from('employee_comp_agreement_events').select('event_type, actor_name, actor_email, metadata, created_at').eq('agreement_id', agreement.id).order('created_at')
      if (eventsError) throw eventsError
      return NextResponse.json({ agreement, events: events || [] })
    }
    const { data, error } = await admin.from('employee_comp_agreements').select('id, agreement_key, agreement_version, status, effective_date, manager_signed_at, sent_at, rep_signed_at, delivery_error, send_claimed_at').eq('org_id', profile.org_id).eq('user_id', userId).order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ agreements: data || [] })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request: NextRequest) {
  try {
    const { authUser, profile } = await requireAuthApi()
    const body = await request.json()
    const agreementKey: unknown = body.agreementKey
    if (!body.consent || !body.managerSignedName?.trim()) return NextResponse.json({ error: 'Manager signature and consent are required' }, { status: 400 })
    if (!isEmployeeAgreementKey(agreementKey)) return NextResponse.json({ error: 'Unknown agreement plan' }, { status: 400 })
    if (!isValidIsoDate(body.effectiveDate)) return NextResponse.json({ error: 'A valid effective date is required' }, { status: 400 })
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey || '')) return NextResponse.json({ error: 'Invalid request key' }, { status: 400 })
    const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    if (!profile.full_name || normalizeName(body.managerSignedName) !== normalizeName(profile.full_name)) return NextResponse.json({ error: 'Typed signature must match your CRM full name' }, { status: 400 })
    const admin = createServiceClient()
    const { data: target } = await admin.from('users').select('id, full_name, email, active, team_id, region_id').eq('id', body.userId).eq('org_id', profile.org_id).maybeSingle()
    if (!target?.active || !target.full_name?.trim() || !target.email?.includes('@')) return NextResponse.json({ error: 'Active rep with a verified full name and email is required' }, { status: 400 })
    if (!(await canManageTarget(admin, authUser.id, profile, target))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (authUser.id === target.id) return NextResponse.json({ error: 'A manager cannot issue an agreement to themselves' }, { status: 400 })
    const template = EMPLOYEE_AGREEMENT_TEMPLATES[agreementKey]
    const snapshot = { ...template, employeeName: target.full_name, employeeEmail: target.email, effectiveDate: body.effectiveDate }
    const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    const { data: agreementId, error: rpcError } = await admin.rpc('create_employee_comp_agreement', { p_org_id: profile.org_id, p_user_id: target.id, p_agreement_key: template.key, p_agreement_version: template.version, p_agreement_snapshot: snapshot, p_content_hash: contentHash, p_request_key: body.requestKey, p_effective_date: body.effectiveDate, p_manager_user_id: authUser.id, p_manager_signed_name: body.managerSignedName.trim(), p_manager_signed_email: profile.email, p_manager_signed_ip: ip, p_manager_signed_user_agent: request.headers.get('user-agent'), p_sent_to_email: target.email })
    if (rpcError?.message?.includes('idempotency_key_payload_mismatch')) return NextResponse.json({ error: 'This request was already used for different agreement details. Close and prepare a new agreement.' }, { status: 409 })
    if (rpcError || !agreementId) throw rpcError || new Error('agreement_create_failed')
    const { data: current } = await admin.from('employee_comp_agreements').select('status').eq('id', agreementId).single()
    if (current?.status === 'sent' || current?.status === 'rep_signed' || current?.status === 'sending') return NextResponse.json({ success: true, agreementId, duplicate: true })
    if (current?.status === 'declined' || current?.status === 'voided') return NextResponse.json({ error: `This agreement is ${current.status}. Prepare a new agreement.` }, { status: 409 })
    try {
      const result = await claimAndSend(admin, { agreementId, actorId: authUser.id, actorName: profile.full_name, actorEmail: profile.email, eventType: 'send_accepted' })
      return NextResponse.json({ success: true, agreementId, duplicate: !result.claimed })
    } catch (error) {
      if (error instanceof Error && error.message === 'delivery_failed') return NextResponse.json({ error: 'Agreement signed, but email could not be sent. Use Retry send from the user profile.' }, { status: 502 })
      throw error
    }
  } catch (error) { return errorResponse(error) }
}

export async function PATCH(request: NextRequest) {
  try {
    const { authUser, profile } = await requireAuthApi()
    const { agreementId } = await request.json()
    if (!agreementId) return NextResponse.json({ error: 'agreementId is required' }, { status: 400 })
    const admin = createServiceClient()
    const { data: agreement } = await admin.from('employee_comp_agreements').select('id, user_id, agreement_key, status, send_claimed_at').eq('id', agreementId).eq('org_id', profile.org_id).maybeSingle()
    const staleSending = agreement?.status === 'sending' && agreement.send_claimed_at && new Date(agreement.send_claimed_at).getTime() < Date.now() - 5 * 60 * 1000
    if (!agreement || (!['manager_signed', 'delivery_failed', 'sent'].includes(agreement.status) && !staleSending) || !isEmployeeAgreementKey(agreement.agreement_key)) return NextResponse.json({ error: 'Agreement cannot be sent' }, { status: 400 })
    const { data: target } = await admin.from('users').select('id, active, team_id, region_id').eq('id', agreement.user_id).eq('org_id', profile.org_id).maybeSingle()
    if (!target?.active) return NextResponse.json({ error: 'Active rep is required' }, { status: 400 })
    if (!(await canManageTarget(admin, authUser.id, profile, target))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    try {
      const result = await claimAndSend(admin, { agreementId: agreement.id, actorId: authUser.id, actorName: profile.full_name, actorEmail: profile.email, eventType: agreement.status === 'manager_signed' ? 'send_accepted' : 'resent' })
      if (!result.claimed) return NextResponse.json({ error: 'Another send is already in progress' }, { status: 409 })
      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof Error && error.message === 'delivery_failed') return NextResponse.json({ error: 'Email could not be sent. Try again later.' }, { status: 502 })
      throw error
    }
  } catch (error) { return errorResponse(error) }
}
