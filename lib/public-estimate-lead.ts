import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import {
  getPublicEstimateDisclaimerForPath,
  getPublicEstimateLeadSourceName,
  getPublicEstimateOrgId,
  isPublicEstimatePaidFallbackPath,
  PUBLIC_ESTIMATE_LEAD_SOURCE_NAME,
  PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME,
  PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE,
  isInPublicEstimateServiceArea,
} from '@/lib/public-estimate-config'
import type { PublicEstimatePreviewSnapshot } from '@/lib/public-estimate-preview-store'
import { getPublicEstimatePreview } from '@/lib/public-estimate-preview-store'
import {
  computePublicEstimatePricing,
  isPublicEstimateRevealPath,
  resolvePublicEstimatePricingPath,
  type PublicEstimateCustomerPath,
  type PublicEstimateRevealPath,
} from '@/lib/public-estimate-pricing'
import { createServiceClient } from '@/lib/supabase/service'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type AdminClient = ReturnType<typeof createServiceClient>

export type PublicEstimateContact = {
  name: string
  email: string
  phone: string
}

export type PublicEstimateLeadResult =
  | {
      ok: true
      lead_id: string
      created: boolean
      estimate_mode: 'auto' | 'manual_design'
      price_low?: number
      price_high?: number
      squares_est?: number
      disclaimer?: string
      estimate_emailed: boolean
      manual_measure_message?: string
    }
  | { ok: false; reason: string; status: number }

export type HomeownerEstimateEmailContent = {
  subject: string
  text: string
  html: string
}

/** Whether to send (or resend after email typo fix). Skips duplicate unlock retries for same address. */
export function shouldSendHomeownerEstimateEmail(
  rawPayload: Record<string, unknown> | null | undefined,
  email: string,
  emailMode?: 'manual' | 'reveal'
): boolean {
  const normalized = email.trim().toLowerCase()
  if (!normalized.includes('@')) return false
  const emailedAt = rawPayload?.homeowner_estimate_emailed_at
  const emailedTo =
    typeof rawPayload?.homeowner_estimate_emailed_to === 'string'
      ? rawPayload.homeowner_estimate_emailed_to.trim().toLowerCase()
      : ''
  if (typeof emailedAt === 'string' && emailedAt && emailedTo === normalized) {
    const desiredMode = emailMode ?? 'manual'
    if (desiredMode === 'reveal') {
      const priorMode = rawPayload?.homeowner_estimate_email_mode
      // Manual acknowledgement (or legacy rows without mode) may be followed by
      // a one-time reveal dollar-range email; only skip when reveal already sent.
      return priorMode !== 'reveal'
    }
    return false
  }
  return true
}

export function buildHomeownerEstimateEmailContent(options: {
  name: string
  email: string
  address: string
  price_low: number
  price_high: number
  squares_est: number
  disclaimer: string
  customerPath?: PublicEstimateCustomerPath
}): HomeownerEstimateEmailContent {
  const { name, address, price_low, price_high, squares_est, disclaimer, customerPath = 'auto' } =
    options
  const paidFallback = isPublicEstimatePaidFallbackPath(customerPath)
  const range = `${formatUsd(price_low)}–${formatUsd(price_high)}`
  const subject = `Your ARX roof estimate for ${address}`
  const imageryLine = paidFallback
    ? 'This conservative estimate range is based on aerial/satellite imagery of your complex roof — satellite views can under-read square footage.'
    : 'This estimate is based on aerial/satellite imagery of your roof.'
  const manualMeasureLine = paidFallback
    ? 'Your roof looks complex from our aerial view, so we will manually measure it on a free inspection to confirm accuracy before any quote.'
    : null
  const text = [
    `Hi ${name},`,
    '',
    'Thanks for using ARX Roofing\'s instant roof estimate.',
    '',
    `Property: ${address}`,
    `Estimated roofing range (shingles): ${range}`,
    `About ${squares_est} squares`,
    '',
    imageryLine,
    ...(manualMeasureLine ? ['', manualMeasureLine] : []),
    '',
    disclaimer,
    '',
    'An ARX team member will call you shortly with a few clarifying, no-pressure questions.',
    '',
    'Questions before we call? Reply to this email or call (704) 313-8834.',
    '',
    '— ARX Roofing & Exteriors',
  ].join('\n')

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#2c2c2a">
  <p style="margin:0 0 16px;font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Thanks for using ARX Roofing's instant roof <strong>estimate</strong>.</p>
  <div style="border:1px solid #e5e5e0;border-radius:10px;padding:20px;margin:0 0 20px;background:#fafaf8">
    <p style="margin:0 0 8px;font-size:13px;color:#6b6b66;text-transform:uppercase;letter-spacing:0.04em">Estimated roofing range (shingles)</p>
    <p style="margin:0 0 12px;font-size:32px;font-weight:700;color:#2c2c2a">${escapeHtml(range)}</p>
    <p style="margin:0 0 4px;font-size:14px;color:#2c2c2a">About ${squares_est} squares</p>
    <p style="margin:0;font-size:14px;color:#2c2c2a">${escapeHtml(address)}</p>
  </div>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#2c2c2a">${escapeHtml(imageryLine)}</p>
  ${
    manualMeasureLine
      ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#2c2c2a">${escapeHtml(manualMeasureLine)}</p>`
      : ''
  }
  <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#2c2c2a"><em>${escapeHtml(disclaimer)}</em></p>
  <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#2c2c2a"><strong>An ARX team member will call you shortly</strong> with a few clarifying, no-pressure questions.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#6b6b66">Questions before we call? Reply to this email or call <a href="tel:+17043138834" style="color:#b45309">(704) 313-8834</a>.</p>
  <p style="margin:24px 0 0;font-size:13px;color:#6b6b66">— ARX Roofing &amp; Exteriors</p>
</div>`

  return { subject, text, html }
}

export function buildHomeownerManualDesignEmailContent(options: {
  name: string
  address: string
}): HomeownerEstimateEmailContent {
  const { name, address } = options
  const subject = `We received your roof request for ${address}`
  const text = [
    `Hi ${name},`,
    '',
    'Thanks for requesting a roof estimate from ARX Roofing.',
    '',
    `Property: ${address}`,
    '',
    'Your roof needs a manual measure by our design team. One of our designers will reach out once they have drawn your roof.',
    '',
    'An ARX team member will call you shortly with next steps.',
    '',
    'Questions before we call? Reply to this email or call (704) 313-8834.',
    '',
    '— ARX Roofing & Exteriors',
  ].join('\n')

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#2c2c2a">
  <p style="margin:0 0 16px;font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Thanks for requesting a roof estimate from ARX Roofing.</p>
  <p style="margin:0 0 12px;font-size:14px;color:#2c2c2a">${escapeHtml(address)}</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#2c2c2a">Your roof needs a manual measure by our design team. One of our designers will reach out once they have drawn your roof.</p>
  <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#2c2c2a"><strong>An ARX team member will call you shortly</strong> with next steps.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#6b6b66">Questions before we call? Reply to this email or call <a href="tel:+17043138834" style="color:#b45309">(704) 313-8834</a>.</p>
  <p style="margin:24px 0 0;font-size:13px;color:#6b6b66">— ARX Roofing &amp; Exteriors</p>
</div>`

  return { subject, text, html }
}

function getMailTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

async function insertLeadWithSchemaFallback(
  adminClient: AdminClient,
  leadData: Record<string, unknown>
) {
  const insertData: Record<string, unknown> = { ...leadData, channel: 'inbound' }
  let lastError: { message?: string; code?: string } | null = null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await adminClient.from('leads').insert(insertData).select('id').single()

    if (!error) return { lead: data as { id: string }, error: null }

    lastError = error
    if (error.code === '23505') {
      return { lead: null, error }
    }
    const missingColumn = error.message?.match(/Could not find the '([^']+)' column/)?.[1]
    if (missingColumn && missingColumn in insertData) {
      delete insertData[missingColumn]
      continue
    }
    if ((error.message?.includes('channel') || error.code === '42703') && 'channel' in insertData) {
      delete insertData.channel
      continue
    }
    break
  }

  return { lead: null, error: lastError }
}

type PublicEstimateLeadSourceRow = {
  id: string
  org_id: string
  name: string
  source_type: string | null
  default_campaign_id: string | null
  field_mapping: unknown
  auto_assign_user_id: string | null
  webhook_enabled: boolean | null
  is_active: boolean | null
}

const LEAD_SOURCE_SELECT =
  'id, org_id, name, source_type, default_campaign_id, field_mapping, auto_assign_user_id, webhook_enabled, is_active'

/**
 * Ensure the Instant Estimate lead source exists.
 * - auto: inherits Website Contact Form / web_leads_owner auto_assign (inside-sales path)
 * - manual_design: separate source with NULL auto_assign (design / ops queue — not inside sales)
 */
async function ensurePublicEstimateLeadSource(
  adminClient: AdminClient,
  orgId: string,
  mode: 'auto' | 'manual_design'
): Promise<PublicEstimateLeadSourceRow | null> {
  // Live lead_sources has no notification_emails / notify_on_new_lead columns.
  // Keep selects/inserts aligned with production schema only.
  const sourceName =
    mode === 'manual_design' ? PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME : PUBLIC_ESTIMATE_LEAD_SOURCE_NAME

  const { data: existing } = await adminClient
    .from('lead_sources')
    .select(LEAD_SOURCE_SELECT)
    .eq('org_id', orgId)
    .eq('name', sourceName)
    .maybeSingle()

  if (existing) return existing as PublicEstimateLeadSourceRow

  const { data: contactFormSource } = await adminClient
    .from('lead_sources')
    .select('auto_assign_user_id, default_campaign_id')
    .eq('org_id', orgId)
    .eq('name', 'Website Contact Form')
    .maybeSingle()

  const { data: autoEstimateSource } = await adminClient
    .from('lead_sources')
    .select('auto_assign_user_id, default_campaign_id')
    .eq('org_id', orgId)
    .eq('name', PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
    .maybeSingle()

  // Campaign: prefer sibling Instant Estimate campaign, else Contact Form. Leave null if neither.
  const defaultCampaignId =
    autoEstimateSource?.default_campaign_id || contactFormSource?.default_campaign_id || null

  let autoAssign: string | null = null
  if (mode === 'auto') {
    // Prefer the same owner as Website Contact Form so routing matches other web leads.
    const { data: org } = await adminClient.from('orgs').select('id, settings').eq('id', orgId).single()
    autoAssign =
      contactFormSource?.auto_assign_user_id || org?.settings?.web_leads_owner_id || null
    if (!autoAssign) {
      const { data: adminUser } = await adminClient
        .from('users')
        .select('id')
        .eq('org_id', orgId)
        .eq('role', 'admin')
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      autoAssign = adminUser?.id || null
    }
  }
  // manual_design: intentionally leave auto_assign null — no design-team user in DB today.

  const { data: created, error } = await adminClient
    .from('lead_sources')
    .insert({
      org_id: orgId,
      name: sourceName,
      source_type: 'website',
      webhook_enabled: true,
      is_active: true,
      auto_assign_user_id: autoAssign,
      default_campaign_id: defaultCampaignId,
    })
    .select(LEAD_SOURCE_SELECT)
    .single()

  if (error) {
    const { data: raced } = await adminClient
      .from('lead_sources')
      .select(LEAD_SOURCE_SELECT)
      .eq('org_id', orgId)
      .eq('name', sourceName)
      .maybeSingle()
    if (raced) return raced as PublicEstimateLeadSourceRow
    console.error('[public-estimate] lead source create failed:', error)
    return null
  }

  return created as PublicEstimateLeadSourceRow
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

/** Exported for unit tests — ops notes differ by auto vs fallback vs silent manual routing. */
export function buildEstimateNotes(options: {
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateCustomerPath
  price_low: number
  price_high: number
  pricePerSquare: number
  disclaimer: string
}): string {
  const { snapshot, customerPath, price_low, price_high, pricePerSquare, disclaimer } = options
  if (customerPath === 'silent_manual') {
    const measureDetail =
      snapshot.squares_mid > 0
        ? `Auto-measure unreliable (est. ${snapshot.squares_low}–${snapshot.squares_high} sq mid ${snapshot.squares_mid} — DO NOT quote customer)`
        : 'No reliable auto-measure from Solar/aerial — manual draw required'
    return [
      'Website Instant Estimate — Manual Measure (design team) — NOT routed to inside sales',
      `Address (locked from aerial preview): ${snapshot.address}`,
      measureDetail,
      `Waste ~${snapshot.waste_percent}% · source=${snapshot.measure_source} · facets=${snapshot.facet_count}`,
      '',
      'No estimate generated for customer — complex roofing system; manual draw required before estimating.',
      'Routing: unassigned in Leads (no inside-sales auto_assign) — grab manually from the leads list.',
    ].join('\n')
  }
  const fallbackLine =
    customerPath === 'fallback_unreliable'
      ? `Auto-measure unreliable — pricing used $${pricePerSquare}/sq FALLBACK (est. ${snapshot.squares_low}–${snapshot.squares_high} sq mid ${snapshot.squares_mid})`
      : customerPath === 'fallback_complex'
        ? `Auto-measure unreliable — pricing used $${pricePerSquare}/sq COMPLEX FALLBACK (est. ${snapshot.squares_low}–${snapshot.squares_high} sq mid ${snapshot.squares_mid})`
        : null
  const fallbackFollowUp = isPublicEstimatePaidFallbackPath(customerPath)
    ? 'Follow-up: complex aerial roof — manual roof measure required to confirm squares before quoting.'
    : null
  return [
    'Website Instant Estimate (unlocked) — CALL IMMEDIATELY',
    `Address (locked from aerial preview): ${snapshot.address}`,
    ...(fallbackLine ? [fallbackLine] : []),
    ...(fallbackFollowUp ? [fallbackFollowUp] : []),
    `Est. squares: ${snapshot.squares_low}–${snapshot.squares_high} (mid ${snapshot.squares_mid})`,
    `Est. range shown to customer: ${formatUsd(price_low)}–${formatUsd(price_high)} @ $${pricePerSquare}/sq shingles (roofing only)`,
    `Waste ~${snapshot.waste_percent}% · source=${snapshot.measure_source} · facets=${snapshot.facet_count}`,
    '',
    'Customer-facing disclaimer (same copy they saw):',
    disclaimer,
    '',
    'Rep coaching: estimate only, not a quote; complexity can change price; no-pressure clarifying questions; extras after inspection.',
  ].join('\n')
}

/**
 * Resolve owner for a new Instant Estimate lead.
 * Silent manual path: always unassigned (null) — do not fall back to web_leads_owner/admin.
 * Auto + paid fallback paths: lead source auto_assign → org web_leads_owner → first active admin.
 */
export function resolvePublicEstimateOwnerUserId(options: {
  customerPath: PublicEstimateCustomerPath
  leadSourceAutoAssignUserId: string | null | undefined
  webLeadsOwnerId: string | null | undefined
  fallbackAdminUserId: string | null | undefined
}): string | null {
  if (options.customerPath === 'silent_manual') return null
  return (
    options.leadSourceAutoAssignUserId ||
    options.webLeadsOwnerId ||
    options.fallbackAdminUserId ||
    null
  )
}

export type ExistingPublicEstimateLeadRow = {
  id: string
  owner_user_id: string | null
  source: string | null
  lead_source_id: string | null
  notes: string | null
  raw_payload: Record<string, unknown> | null
}

const REVEAL_PRICING_MODES = new Set<PublicEstimateRevealPath>([
  'auto',
  'fallback_unreliable',
  'fallback_complex',
])

/** Structured raw_payload shows reveal routing was already applied (prefer over stale source/notes). */
export function isLeadAlreadyOnRevealRouting(
  raw_payload: Record<string, unknown> | null | undefined
): boolean {
  const raw = raw_payload
  if (!raw) return false
  const pricingMode = raw.pricing_mode
  if (typeof pricingMode === 'string' && REVEAL_PRICING_MODES.has(pricingMode as PublicEstimateRevealPath)) {
    return true
  }
  if (raw.estimate_mode === 'auto') {
    const priceLow = raw.price_low
    const priceHigh = raw.price_high
    const hasDollars =
      (typeof priceLow === 'number' && priceLow > 0) ||
      (typeof priceHigh === 'number' && priceHigh > 0)
    if (hasDollars) return true
  }
  return false
}

/** True when CRM row still reflects silent-manual / design-team routing (not inside sales). */
export function isLeadOnSilentManualRouting(lead: {
  owner_user_id?: string | null
  source?: string | null
  notes?: string | null
  raw_payload?: Record<string, unknown> | null
}): boolean {
  if (isLeadAlreadyOnRevealRouting(lead.raw_payload)) return false
  const raw = lead.raw_payload
  if (raw?.estimate_mode === 'manual_design') return true
  if (raw?.pricing_mode === 'silent_manual') return true
  if (lead.source === PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME) return true
  const notes = lead.notes ?? ''
  if (notes.includes('NOT routed to inside sales')) return true
  if (notes.includes('DO NOT quote')) return true
  if (!lead.owner_user_id && notes.includes('Manual Measure')) return true
  return false
}

/** Idempotent unlock: promote silent-manual row when snapshot now classifies as reveal path. */
export function shouldPromoteExistingLeadToRevealPath(
  customerPath: PublicEstimateCustomerPath,
  existing: ExistingPublicEstimateLeadRow
): boolean {
  if (!isPublicEstimateRevealPath(customerPath)) return false
  if (isLeadAlreadyOnRevealRouting(existing.raw_payload)) return false
  return isLeadOnSilentManualRouting(existing)
}

/** raw_payload shows reveal but CRM columns were not reconciled (e.g. prior reconcile failure). */
export function leadNeedsRevealCrmReconcile(existing: ExistingPublicEstimateLeadRow): boolean {
  if (!isLeadAlreadyOnRevealRouting(existing.raw_payload)) return false
  if (existing.source === PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME) return true
  if (!existing.owner_user_id) return true
  const notes = existing.notes ?? ''
  if (notes.includes('DO NOT quote')) return true
  if (notes.includes('NOT routed to inside sales')) return true
  return false
}

export type PublicEstimateUnlockBackfillPath = 'manual' | 'reveal'

type PublicEstimateUnlockBackfillLead = {
  source?: string | null
  notes?: string | null
  owner_user_id?: string | null
  email?: string | null
  raw_payload?: Record<string, unknown> | null
}

/**
 * Backfill-only silent-manual classification. CRM columns win over reveal-shaped
 * raw_payload so partial promotions stay recoverable via leadNeedsRevealCrmReconcile.
 * Keep in sync with supabase/migrations/202607240002_public_estimate_unlock_delivery_state.sql
 */
export function isPublicEstimateUnlockBackfillSilentManual(
  lead: PublicEstimateUnlockBackfillLead
): boolean {
  if (lead.source === PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME) return true
  const notes = lead.notes ?? ''
  if (notes.includes('NOT routed to inside sales')) return true
  if (notes.includes('DO NOT quote')) return true
  const raw = lead.raw_payload
  if (raw?.homeowner_estimate_email_mode === 'manual') return true
  const emailMode = raw?.homeowner_estimate_email_mode
  if (
    (raw?.pricing_mode === 'silent_manual' || raw?.estimate_mode === 'manual_design') &&
    emailMode !== 'reveal'
  ) {
    return true
  }
  return false
}

/** Backfill-only reveal classification when CRM/email_mode confirms delivery completed. */
export function isPublicEstimateUnlockBackfillReveal(
  lead: PublicEstimateUnlockBackfillLead
): boolean {
  if (isPublicEstimateUnlockBackfillSilentManual(lead)) return false
  const raw = lead.raw_payload
  const emailMode = raw?.homeowner_estimate_email_mode
  if (emailMode === 'reveal') return true
  const notes = lead.notes ?? ''
  if (
    lead.source === PUBLIC_ESTIMATE_LEAD_SOURCE_NAME &&
    (notes.includes('CALL IMMEDIATELY') || lead.owner_user_id != null)
  ) {
    return true
  }
  if (emailMode == null && isLeadAlreadyOnRevealRouting(raw)) {
    return true
  }
  return false
}

/** Classify historical unlock side effects for delivery-state backfill. */
export function classifyPublicEstimateUnlockBackfillPath(
  lead: PublicEstimateUnlockBackfillLead
): PublicEstimateUnlockBackfillPath | null {
  if (isPublicEstimateUnlockBackfillSilentManual(lead)) return 'manual'
  if (isPublicEstimateUnlockBackfillReveal(lead)) return 'reveal'
  return null
}

/** Homeowner-estimate delivery key for migration backfill; null when not yet emailed. */
export function classifyPublicEstimateHomeownerBackfillKey(
  lead: PublicEstimateUnlockBackfillLead
): `homeowner-estimate:${'manual' | 'reveal'}:${string}` | null {
  const email = lead.email?.trim().toLowerCase()
  if (!email?.includes('@')) return null
  const raw = lead.raw_payload
  const emailedAt = raw?.homeowner_estimate_emailed_at
  if (typeof emailedAt !== 'string' || !emailedAt) return null
  if (isPublicEstimateUnlockBackfillSilentManual(lead)) {
    return `homeowner-estimate:manual:${email}`
  }
  const emailMode = raw?.homeowner_estimate_email_mode
  if (emailMode === 'reveal' || emailMode == null) {
    return `homeowner-estimate:reveal:${email}`
  }
  return null
}

async function resolveRevealPathOwnerAndLeadSource(
  adminClient: AdminClient,
  orgId: string,
  customerPath: PublicEstimateRevealPath
): Promise<{ leadSource: PublicEstimateLeadSourceRow | null; ownerUserId: string | null }> {
  const leadSource = await ensurePublicEstimateLeadSource(adminClient, orgId, 'auto')
  const { data: org } = await adminClient.from('orgs').select('id, settings').eq('id', orgId).single()

  let fallbackAdminUserId: string | null = null
  const needsFallback = !leadSource?.auto_assign_user_id && !org?.settings?.web_leads_owner_id
  if (needsFallback) {
    const { data: adminUser } = await adminClient
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle()
    fallbackAdminUserId = adminUser?.id || null
  }

  const ownerUserId = resolvePublicEstimateOwnerUserId({
    customerPath,
    leadSourceAutoAssignUserId: leadSource?.auto_assign_user_id,
    webLeadsOwnerId: org?.settings?.web_leads_owner_id,
    fallbackAdminUserId,
  })

  return { leadSource, ownerUserId }
}

async function reconcileLeadToInstantEstimateRevealPath(options: {
  adminClient: AdminClient
  leadId: string
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateRevealPath
  price_low: number
  price_high: number
  pricePerSquare: number
  disclaimer: string
  leadSource: PublicEstimateLeadSourceRow | null
  ownerUserId: string | null
}): Promise<boolean> {
  const {
    adminClient,
    leadId,
    snapshot,
    customerPath,
    price_low,
    price_high,
    pricePerSquare,
    disclaimer,
    leadSource,
    ownerUserId,
  } = options

  const { error } = await adminClient
    .from('leads')
    .update({
      owner_user_id: ownerUserId,
      source: getPublicEstimateLeadSourceName(false),
      lead_source_id: leadSource?.id || null,
      campaign_id: leadSource?.default_campaign_id || null,
      notes: buildEstimateNotes({
        snapshot,
        customerPath,
        price_low,
        price_high,
        pricePerSquare,
        disclaimer,
      }),
    })
    .eq('id', leadId)

  if (error) {
    console.error('[public-estimate] reveal reconcile failed:', error)
    return false
  }
  const { data: reconciled, error: verifyError } = await adminClient
    .from('leads')
    .select('owner_user_id, source, notes')
    .eq('id', leadId)
    .maybeSingle()
  if (
    verifyError ||
    !reconciled ||
    reconciled.owner_user_id !== ownerUserId ||
    reconciled.source !== PUBLIC_ESTIMATE_LEAD_SOURCE_NAME ||
    typeof reconciled.notes !== 'string' ||
    !reconciled.notes.includes('CALL IMMEDIATELY')
  ) {
    console.error('[public-estimate] reveal reconcile verification failed:', verifyError)
    return false
  }
  return true
}

type PublicEstimateUnlockDeliveryKey =
  | `lead-activity:${'manual' | 'reveal'}`
  | 'owner-notification:reveal'
  | `ops-email:${'manual' | 'reveal'}`
  | `homeowner-estimate:${string}:${string}`

type PublicEstimateUnlockDeliveryClaim = {
  deliveryKey: PublicEstimateUnlockDeliveryKey
  attemptId: string
}

type PublicEstimateUnlockDeliveryClaimResult =
  | { status: 'claimed'; claim: PublicEstimateUnlockDeliveryClaim }
  | { status: 'already_claimed' }
  | { status: 'rpc_unavailable'; error: unknown }

/**
 * Atomically reserves a one-time unlock side effect. The database constraint is
 * the concurrency boundary; raw_payload is useful audit data but is not safe
 * for read-then-write delivery dedupe across parallel requests.
 */
async function claimPublicEstimateUnlockDelivery(
  adminClient: AdminClient,
  orgId: string,
  leadId: string,
  deliveryKey: PublicEstimateUnlockDeliveryKey
): Promise<PublicEstimateUnlockDeliveryClaimResult> {
  const { data, error } = await adminClient.rpc('claim_public_estimate_unlock_delivery', {
    p_org_id: orgId,
    p_lead_id: leadId,
    p_delivery_key: deliveryKey,
  })
  if (error) {
    return { status: 'rpc_unavailable', error }
  }
  if (typeof data === 'string' && data) {
    return { status: 'claimed', claim: { deliveryKey, attemptId: data } }
  }
  return { status: 'already_claimed' }
}

async function completePublicEstimateUnlockDelivery(
  adminClient: AdminClient,
  leadId: string,
  claim: PublicEstimateUnlockDeliveryClaim
): Promise<void> {
  const { error } = await adminClient.rpc('complete_public_estimate_unlock_delivery', {
    p_lead_id: leadId,
    p_delivery_key: claim.deliveryKey,
    p_attempt_id: claim.attemptId,
  })
  if (error) console.error('[public-estimate] unlock delivery completion failed:', error)
}

async function failPublicEstimateUnlockDelivery(
  adminClient: AdminClient,
  leadId: string,
  claim: PublicEstimateUnlockDeliveryClaim
): Promise<void> {
  const { error } = await adminClient.rpc('fail_public_estimate_unlock_delivery', {
    p_lead_id: leadId,
    p_delivery_key: claim.deliveryKey,
    p_attempt_id: claim.attemptId,
  })
  if (error) console.error('[public-estimate] unlock delivery failure update failed:', error)
}

async function runClaimedPublicEstimateUnlockDelivery(
  adminClient: AdminClient,
  orgId: string,
  leadId: string,
  deliveryKey: PublicEstimateUnlockDeliveryKey,
  deliver: () => Promise<void>
): Promise<boolean> {
  const claimResult = await claimPublicEstimateUnlockDelivery(
    adminClient,
    orgId,
    leadId,
    deliveryKey
  )

  if (claimResult.status === 'already_claimed') {
    return false
  }

  if (claimResult.status === 'rpc_unavailable') {
    console.error(
      `[public-estimate] unlock delivery-state RPC unavailable for ${deliveryKey} — proceeding without claim/complete/fail; idempotency is degraded:`,
      claimResult.error
    )
    try {
      await deliver()
      return true
    } catch (error) {
      console.error(
        `[public-estimate] ${deliveryKey} delivery failed (degraded idempotency):`,
        error
      )
      return false
    }
  }

  const claim = claimResult.claim
  try {
    await deliver()
    await completePublicEstimateUnlockDelivery(adminClient, leadId, claim)
    return true
  } catch (error) {
    await failPublicEstimateUnlockDelivery(adminClient, leadId, claim)
    console.error(`[public-estimate] ${deliveryKey} delivery failed:`, error)
    return false
  }
}

function homeownerEstimateDeliveryKey(
  customerPath: PublicEstimateCustomerPath,
  email: string
): PublicEstimateUnlockDeliveryKey {
  // Manual-design acknowledgement and the later paid reveal are intentionally
  // different messages. All reveal pricing paths share one key so a retry or a
  // reclassification cannot send the homeowner a second dollar-range email.
  const mode = customerPath === 'silent_manual' ? 'manual' : 'reveal'
  return `homeowner-estimate:${mode}:${email.trim().toLowerCase()}`
}

function buildRawPayload(options: {
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateCustomerPath
  tokenExp: number
  contact: PublicEstimateContact
  previewToken: string
  pricePerSquare: number
  price_low: number
  price_high: number
}): Record<string, unknown> {
  const {
    snapshot,
    customerPath,
    tokenExp,
    contact,
    previewToken,
    pricePerSquare,
    price_low,
    price_high,
  } = options
  return {
    funnel: 'website_instant_estimate',
    preview_jti: snapshot.jti,
    preview_token_exp: tokenExp,
    address: snapshot.address,
    lat: snapshot.lat,
    lng: snapshot.lng,
    squares_mid: snapshot.squares_mid,
    squares_low: snapshot.squares_low,
    squares_high: snapshot.squares_high,
    price_per_square: pricePerSquare,
    price_low,
    price_high,
    waste_percent: snapshot.waste_percent,
    measure_source: snapshot.measure_source,
    facet_count: snapshot.facet_count,
    requires_manual_measure: snapshot.requires_manual_measure,
    pricing_mode: customerPath,
    estimate_mode: customerPath === 'silent_manual' ? 'manual_design' : 'auto',
    homeowner_name: contact.name,
    email: contact.email,
    phone: contact.phone,
    unlocked_at: new Date().toISOString(),
    preview_token_prefix: previewToken.slice(0, 24),
  }
}

async function refreshPublicEstimateLeadContact(
  adminClient: AdminClient,
  leadId: string,
  contact: PublicEstimateContact,
  rawPayloadPatch: Record<string, unknown>
): Promise<void> {
  const { data: existing } = await adminClient
    .from('leads')
    .select('raw_payload')
    .eq('id', leadId)
    .maybeSingle()

  const prior =
    existing?.raw_payload && typeof existing.raw_payload === 'object' && !Array.isArray(existing.raw_payload)
      ? (existing.raw_payload as Record<string, unknown>)
      : {}

  await adminClient
    .from('leads')
    .update({
      homeowner_name: contact.name,
      email: contact.email,
      phone: contact.phone,
      raw_payload: { ...prior, ...rawPayloadPatch },
    })
    .eq('id', leadId)
}

function normalizeLeadRawPayload(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

async function fetchLeadByExternalId(
  adminClient: AdminClient,
  orgId: string,
  externalLeadId: string
): Promise<ExistingPublicEstimateLeadRow | null> {
  const { data } = await adminClient
    .from('leads')
    .select('id, owner_user_id, source, lead_source_id, notes, raw_payload')
    .eq('org_id', orgId)
    .eq('external_lead_id', externalLeadId)
    .limit(1)
    .maybeSingle()

  if (!data?.id) return null

  return {
    id: data.id,
    owner_user_id: data.owner_user_id ?? null,
    source: data.source ?? null,
    lead_source_id: data.lead_source_id ?? null,
    notes: data.notes ?? null,
    raw_payload: normalizeLeadRawPayload(data.raw_payload),
  }
}

async function handleExistingPublicEstimateLeadUnlock(options: {
  adminClient: AdminClient
  orgId: string
  existing: ExistingPublicEstimateLeadRow
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateCustomerPath
  contact: PublicEstimateContact
  rawPayload: Record<string, unknown>
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
}): Promise<PublicEstimateLeadResult> {
  const {
    adminClient,
    orgId,
    existing,
    snapshot,
    customerPath,
    contact,
    rawPayload,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  } = options

  const alreadyRevealRouted = isLeadAlreadyOnRevealRouting(existing.raw_payload)
  const wasSilentManual = isLeadOnSilentManualRouting(existing)
  const shouldPromote = shouldPromoteExistingLeadToRevealPath(customerPath, existing)
  const needsSilentReconcile =
    !shouldPromote &&
    isPublicEstimateRevealPath(customerPath) &&
    leadNeedsRevealCrmReconcile(existing)

  if (shouldPromote || needsSilentReconcile) {
    const revealPath = isPublicEstimateRevealPath(customerPath) ? customerPath : 'auto'
    const { leadSource, ownerUserId } = await resolveRevealPathOwnerAndLeadSource(
      adminClient,
      orgId,
      revealPath
    )
    if (!leadSource?.id || !ownerUserId) {
      console.error('[public-estimate] reveal routing unavailable')
      return { ok: false, reason: 'reveal_routing_unavailable', status: 503 }
    }
    const reconciled = await reconcileLeadToInstantEstimateRevealPath({
      adminClient,
      leadId: existing.id,
      snapshot,
      customerPath: revealPath,
      price_low,
      price_high,
      pricePerSquare,
      disclaimer,
      leadSource,
      ownerUserId,
    })

    // Never persist reveal payload or return a paid range while the lead is
    // still routed to Manual Measure. A retry can safely reconcile later.
    if (!reconciled) {
      return { ok: false, reason: 'reveal_reconcile_failed', status: 503 }
    }

    const firstRevealPromotion =
      (shouldPromote && wasSilentManual && !alreadyRevealRouted) || needsSilentReconcile

    // Deliver/claim the one-time promotion effects before raw_payload records
    // reveal mode. If this request dies mid-delivery, the next retry still
    // sees a manual payload and re-enters this recovery path; the database
    // delivery claims suppress duplicates.
    const result = await finalizePublicEstimateUnlock({
      adminClient,
      leadId: existing.id,
      created: false,
      forceHomeownerRevealEmail: firstRevealPromotion,
      snapshot,
      customerPath,
      contact,
      price_low,
      price_high,
      squares_est,
      pricePerSquare,
      disclaimer,
      leadSource,
      ownerUserId,
    })
    await refreshPublicEstimateLeadContact(adminClient, existing.id, contact, rawPayload)
    return result
  }

  await refreshPublicEstimateLeadContact(adminClient, existing.id, contact, rawPayload)

  return finalizePublicEstimateUnlock({
    adminClient,
    leadId: existing.id,
    created: false,
    snapshot,
    customerPath,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
    leadSource: null,
    ownerUserId: null,
  })
}

function successResult(options: {
  lead_id: string
  created: boolean
  estimate_mode: 'auto' | 'manual_design'
  price_low?: number
  price_high?: number
  squares_est?: number
  disclaimer?: string
  estimate_emailed: boolean
  manual_measure_message?: string
}): PublicEstimateLeadResult {
  return { ok: true, ...options }
}

function snapshotFromLeadRawPayload(
  jti: string,
  raw: Record<string, unknown>,
  fallback?: { address_text?: string | null; lat?: number | null; lng?: number | null }
): PublicEstimatePreviewSnapshot | null {
  const address =
    (typeof raw.address === 'string' && raw.address) ||
    fallback?.address_text ||
    ''
  const lat = typeof raw.lat === 'number' ? raw.lat : fallback?.lat
  const lng = typeof raw.lng === 'number' ? raw.lng : fallback?.lng
  const squares_mid = typeof raw.squares_mid === 'number' ? raw.squares_mid : null
  const squares_low = typeof raw.squares_low === 'number' ? raw.squares_low : null
  const squares_high = typeof raw.squares_high === 'number' ? raw.squares_high : null
  const waste_percent = typeof raw.waste_percent === 'number' ? raw.waste_percent : null
  const facet_count = typeof raw.facet_count === 'number' ? raw.facet_count : null
  const measure_source = typeof raw.measure_source === 'string' ? raw.measure_source : null
  const requires_manual_measure =
    raw.requires_manual_measure === true ||
    raw.estimate_mode === 'manual_design' ||
    (squares_mid === 0 && squares_low === 0 && squares_high === 0)

  if (
    !address ||
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    squares_mid == null ||
    squares_low == null ||
    squares_high == null ||
    waste_percent == null ||
    facet_count == null ||
    !measure_source
  ) {
    return null
  }

  return {
    jti,
    address,
    lat,
    lng,
    squares_mid,
    squares_low,
    squares_high,
    waste_percent,
    facet_count,
    measure_source,
    requires_manual_measure,
    expiresAt: Number.MAX_SAFE_INTEGER,
  }
}

/** Shared DB preview store first; fall back to an existing unlocked lead for typo retries. */
export async function resolvePublicEstimateSnapshotForUnlock(
  jti: string
): Promise<PublicEstimatePreviewSnapshot | null> {
  const fromStore = await getPublicEstimatePreview(jti)
  if (fromStore) return fromStore

  const adminClient = createServiceClient()
  const { data: lead } = await adminClient
    .from('leads')
    .select('raw_payload, address_text, lat, lng')
    .eq('org_id', getPublicEstimateOrgId())
    .eq('external_lead_id', `public-estimate:${jti}`)
    .limit(1)
    .maybeSingle()

  if (!lead?.raw_payload || typeof lead.raw_payload !== 'object' || Array.isArray(lead.raw_payload)) {
    return null
  }

  return snapshotFromLeadRawPayload(jti, lead.raw_payload as Record<string, unknown>, {
    address_text: lead.address_text,
    lat: lead.lat,
    lng: lead.lng,
  })
}

async function sendNewPublicEstimateLeadAlerts(options: {
  adminClient: AdminClient
  orgId: string
  leadId: string
  leadSource: PublicEstimateLeadSourceRow | null
  ownerUserId: string | null
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateCustomerPath
  contact: PublicEstimateContact
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
}) {
  const {
    adminClient,
    orgId,
    leadId,
    leadSource,
    ownerUserId,
    snapshot,
    customerPath,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  } = options
  const { name, email, phone } = contact
  const silentManual = customerPath === 'silent_manual'
  const deliveryMode = silentManual ? 'manual' : 'reveal'

  await runClaimedPublicEstimateUnlockDelivery(
    adminClient,
    orgId,
    leadId,
    `lead-activity:${deliveryMode}`,
    async () => {
      const { error } = await adminClient.from('activities').insert({
        org_id: orgId,
        lead_id: leadId,
        user_id: ownerUserId,
        type: 'note',
        body: silentManual
          ? `Complex roofing system — no estimate generated. Unassigned in Leads for manual pickup · ${snapshot.address}`
          : `Instant website estimate unlocked — CALL NOW. ${formatUsd(price_low)}–${formatUsd(price_high)} · ${snapshot.address}`,
      })
      if (error) throw error
    }
  )

  // Auto + fallback path: notify assigned inside-sales / web-leads owner.
  // Silent manual: owner is null by design — skip in-app user notification (info@ email only).
  if (ownerUserId && !silentManual) {
    const notifBase = {
      org_id: orgId,
      type: 'new_lead',
      title: 'CALL NOW — Website Instant Estimate',
      body: `${name} · ${phone} · ${snapshot.address} · ${formatUsd(price_low)}–${formatUsd(price_high)}. Estimate only (not a quote); complexity may change price; no-pressure follow-up.`,
    }
    await runClaimedPublicEstimateUnlockDelivery(
      adminClient,
      orgId,
      leadId,
      'owner-notification:reveal',
      async () => {
        const primary = await adminClient.from('notifications').insert({
        ...notifBase,
        recipient_user_id: ownerUserId,
        link_url: `/leads/${leadId}`,
        })
        if (!primary.error) return
        const fallback = await adminClient.from('notifications').insert({
          ...notifBase,
          user_id: ownerUserId,
          link_url: `/leads/${leadId}`,
          read: false,
        })
        if (fallback.error) throw fallback.error
      }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
  const leadUrl = `${appUrl}/leads/${leadId}`
  // Primary internal alert inbox. Live lead_sources has no notification_emails column —
  // do not select/insert that field. Owner email is still added when auto-assigned (auto path only).
  const emailRecipients = new Set<string>(['info@arxroofing.com'])
  const notifyEmails = (leadSource as { notification_emails?: unknown } | null)?.notification_emails
  if (Array.isArray(notifyEmails)) {
    for (const e of notifyEmails) {
      if (typeof e === 'string' && e.includes('@')) emailRecipients.add(e.trim().toLowerCase())
    }
  }
  if (ownerUserId && !silentManual) {
    const { data: owner } = await adminClient
      .from('users')
      .select('email')
      .eq('id', ownerUserId)
      .maybeSingle()
    if (owner?.email) emailRecipients.add(String(owner.email).toLowerCase())
  }

  await runClaimedPublicEstimateUnlockDelivery(
    adminClient,
    orgId,
    leadId,
    `ops-email:${deliveryMode}`,
    async () => {
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
        throw new Error('SMTP not configured')
      }
      const alert = buildOpsAlertEmailContent({
        customerPath,
        name,
        phone,
        email,
        address: snapshot.address,
        measure_source: snapshot.measure_source,
        facet_count: snapshot.facet_count,
        leadUrl,
        price_low,
        price_high,
        squares_est,
        pricePerSquare,
        disclaimer,
      })
      await getMailTransport().sendMail({
        from: getCrmEmailFrom(),
        to: Array.from(emailRecipients).join(', '),
        subject: alert.subject,
        text: alert.text,
        html: alert.html,
      })
    }
  )
}

/** Ops alert email copy — exported for unit tests. Silent manual path is not CALL NOW. */
export function buildOpsAlertEmailContent(options: {
  customerPath: PublicEstimateCustomerPath
  name: string
  phone: string
  email: string
  address: string
  measure_source: string
  facet_count: number
  leadUrl: string
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
}): { subject: string; text: string; html: string } {
  const {
    customerPath,
    name,
    phone,
    email,
    address,
    measure_source,
    facet_count,
    leadUrl,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  } = options
  const silentManual = customerPath === 'silent_manual'
  const paidFallback = isPublicEstimatePaidFallbackPath(customerPath)
  const fallbackLabel =
    customerPath === 'fallback_complex'
      ? `$${pricePerSquare}/sq COMPLEX FALLBACK`
      : customerPath === 'fallback_unreliable'
        ? `$${pricePerSquare}/sq FALLBACK`
        : null

  if (silentManual) {
    const subject = `Complex roof — no estimate generated: ${name}`
    const text = [
      'A homeowner used Website Instant Estimate on a complex roofing system.',
      'No estimate was generated (no dollar range shown to the customer).',
      '',
      'This lead is unassigned in Leads — grab it manually. It is NOT auto-assigned to inside sales.',
      '',
      `Name: ${name}`,
      `Phone: ${phone}`,
      `Email: ${email}`,
      `Address: ${address}`,
      `Measure source: ${measure_source} · facets=${facet_count}`,
      `Lead source: ${PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME}`,
      '',
      'Next step: manually draw the roof, then follow up with an estimate.',
      '',
      `Lead: ${leadUrl}`,
    ].join('\n')
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
          <h2 style="color:#2c2c2a;margin:0 0 12px">Complex roof — no estimate generated</h2>
          <p style="color:#2c2c2a"><strong>${escapeHtml(name)}</strong> submitted Instant Estimate on a <strong>complex roofing system</strong>. No dollar estimate was shown.</p>
          <p style="color:#2c2c2a;font-size:14px;line-height:1.45">Lead is <strong>unassigned in Leads</strong> for manual pickup — not auto-assigned to inside sales.</p>
          <ul style="color:#2c2c2a">
            <li>Phone: <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a></li>
            <li>Email: ${escapeHtml(email)}</li>
            <li>Address: ${escapeHtml(address)}</li>
            <li>Source: ${escapeHtml(measure_source)} · ${facet_count} facets</li>
            <li>Lead source: ${escapeHtml(PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME)}</li>
          </ul>
          <p style="color:#2c2c2a;font-size:14px;line-height:1.45">Next step: manually draw the roof, then follow up with an estimate.</p>
          <p><a href="${escapeHtml(leadUrl)}" style="background:#b45309;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Open lead in CRM</a></p>
        </div>`
    return { subject, text, html }
  }

  const subject = `CALL NOW — Instant Estimate: ${name} (${formatUsd(price_low)}–${formatUsd(price_high)})`
  const fallbackContext = paidFallback
    ? [
        `Complex aerial roof — conservative range shown using ${fallbackLabel}.`,
        'Follow-up: schedule manual roof measure to confirm squares before quoting.',
        '',
      ]
    : []
  const text = [
    'A homeowner just unlocked a website roof estimate. Call immediately.',
    '',
    ...fallbackContext,
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    `Address: ${address}`,
    `Estimate shown: ${formatUsd(price_low)}–${formatUsd(price_high)} (est. ${squares_est} sq @ $${pricePerSquare}/sq shingles — roofing only)`,
    '',
    'Customer was told: estimate only (not a quote); based on roof complexity the price could be different; you will ask clarifying no-pressure questions.',
    disclaimer,
    '',
    `Lead: ${leadUrl}`,
  ].join('\n')
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
          <h2 style="color:#b45309;margin:0 0 12px">CALL NOW — Website Instant Estimate</h2>
          <p style="color:#2c2c2a"><strong>${escapeHtml(name)}</strong> just unlocked their estimate.</p>
          ${
            paidFallback
              ? `<p style="color:#2c2c2a;font-size:14px;line-height:1.45"><strong>Complex aerial roof</strong> — conservative range at ${escapeHtml(fallbackLabel || '')}. Schedule manual roof measure follow-up before quoting.</p>`
              : ''
          }
          <ul style="color:#2c2c2a">
            <li>Phone: <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a></li>
            <li>Email: ${escapeHtml(email)}</li>
            <li>Address: ${escapeHtml(address)}</li>
            <li>Estimate: <strong>${escapeHtml(formatUsd(price_low))}–${escapeHtml(formatUsd(price_high))}</strong> (est. ${squares_est} squares · $${pricePerSquare}/sq shingles)</li>
          </ul>
          <p style="color:#2c2c2a;font-size:14px;line-height:1.45"><em>${escapeHtml(disclaimer)}</em></p>
          <p><a href="${escapeHtml(leadUrl)}" style="background:#b45309;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Open lead in CRM</a></p>
        </div>`
  return { subject, text, html }
}

async function fetchLeadRawPayload(
  adminClient: AdminClient,
  leadId: string
): Promise<Record<string, unknown>> {
  const { data: existing } = await adminClient
    .from('leads')
    .select('raw_payload')
    .eq('id', leadId)
    .maybeSingle()

  if (
    existing?.raw_payload &&
    typeof existing.raw_payload === 'object' &&
    !Array.isArray(existing.raw_payload)
  ) {
    return existing.raw_payload as Record<string, unknown>
  }
  return {}
}

async function markHomeownerEstimateEmailed(
  adminClient: AdminClient,
  leadId: string,
  email: string,
  emailMode: 'manual' | 'reveal'
): Promise<void> {
  const prior = await fetchLeadRawPayload(adminClient, leadId)
  const emailedAt = new Date().toISOString()
  await adminClient
    .from('leads')
    .update({
      raw_payload: {
        ...prior,
        homeowner_estimate_emailed_at: emailedAt,
        homeowner_estimate_emailed_to: email.trim().toLowerCase(),
        homeowner_estimate_email_mode: emailMode,
      },
    })
    .eq('id', leadId)
}

/**
 * Emails the unlocked estimate to the homeowner. Never throws — unlock must succeed regardless.
 * Dedupes via raw_payload homeowner_estimate_emailed_at + emailed_to (resends if email typo fixed).
 */
async function maybeSendHomeownerEstimateEmail(options: {
  adminClient: AdminClient
  leadId: string
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateCustomerPath
  contact: PublicEstimateContact
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
  /** One-time promotion from silent-manual → reveal path may resend with dollar range. */
  forceHomeownerRevealEmail?: boolean
}): Promise<boolean> {
  const {
    adminClient,
    leadId,
    snapshot,
    customerPath,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
    forceHomeownerRevealEmail = false,
  } = options
  const { name, email } = contact
  const emailMode = customerPath === 'silent_manual' ? 'manual' : 'reveal'
  const deliveryKey = homeownerEstimateDeliveryKey(customerPath, email)

  try {
    const priorRaw = await fetchLeadRawPayload(adminClient, leadId)
    if (
      !forceHomeownerRevealEmail &&
      !shouldSendHomeownerEstimateEmail(priorRaw, email, emailMode)
    ) {
      return false
    }

    const { subject, text, html } =
      customerPath === 'silent_manual'
        ? buildHomeownerManualDesignEmailContent({
            name,
            address: snapshot.address,
          })
        : buildHomeownerEstimateEmailContent({
            name,
            email,
            address: snapshot.address,
            price_low,
            price_high,
            squares_est,
            disclaimer,
            customerPath,
          })

    return runClaimedPublicEstimateUnlockDelivery(
      adminClient,
      getPublicEstimateOrgId(),
      leadId,
      deliveryKey,
      async () => {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
          throw new Error('SMTP not configured')
        }
        await getMailTransport().sendMail({
          from: getCrmEmailFrom(),
          to: email,
          subject,
          text,
          html,
        })
        await markHomeownerEstimateEmailed(adminClient, leadId, email, emailMode)
      }
    )
  } catch (e) {
    console.error('[public-estimate] homeowner estimate email failed:', e)
    return false
  }
}

async function finalizePublicEstimateUnlock(options: {
  adminClient: AdminClient
  leadId: string
  created: boolean
  forceHomeownerRevealEmail?: boolean
  snapshot: PublicEstimatePreviewSnapshot
  customerPath: PublicEstimateCustomerPath
  contact: PublicEstimateContact
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
  leadSource: PublicEstimateLeadSourceRow | null
  ownerUserId: string | null
}): Promise<PublicEstimateLeadResult> {
  const {
    adminClient,
    leadId,
    created,
    forceHomeownerRevealEmail = false,
    snapshot,
    customerPath,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
    leadSource,
    ownerUserId,
  } = options

  // Completed channels are a no-op; explicitly failed channels are retried.
  // The delivery-state migration backfills historical leads to avoid replaying
  // pre-deployment alerts on their first retry.
  await sendNewPublicEstimateLeadAlerts({
    adminClient,
    orgId: getPublicEstimateOrgId(),
    leadId,
    leadSource,
    ownerUserId,
    snapshot,
    customerPath,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  })

  const estimate_emailed = await maybeSendHomeownerEstimateEmail({
    adminClient,
    leadId,
    snapshot,
    customerPath,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
    forceHomeownerRevealEmail,
  })

  if (customerPath === 'silent_manual') {
    return successResult({
      lead_id: leadId,
      created,
      estimate_mode: 'manual_design',
      estimate_emailed,
      manual_measure_message: PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE,
    })
  }

  return successResult({
    lead_id: leadId,
    created,
    estimate_mode: 'auto',
    price_low,
    price_high,
    squares_est,
    disclaimer,
    estimate_emailed,
  })
}

/**
 * Create (or return existing) inbound lead for an unlocked public estimate.
 * Address + measurement ALWAYS come from the server preview snapshot — never unlock body.
 * Name, email, and phone are required on contact; retries update stale contact fields.
 */
export async function createOrGetPublicEstimateLead(options: {
  snapshot: PublicEstimatePreviewSnapshot
  tokenExp: number
  contact: PublicEstimateContact
  previewToken: string
}): Promise<PublicEstimateLeadResult> {
  const { snapshot, tokenExp, contact, previewToken } = options
  const name = contact.name.trim()
  const email = contact.email.trim().toLowerCase()
  const phone = contact.phone.trim()

  if (!name) return { ok: false, reason: 'name_required', status: 400 }
  if (!email || !email.includes('@')) return { ok: false, reason: 'email_required', status: 400 }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return { ok: false, reason: 'phone_required', status: 400 }
  }

  if (!isInPublicEstimateServiceArea(snapshot.lat, snapshot.lng)) {
    return { ok: false, reason: 'out_of_service_area', status: 422 }
  }

  const adminClient = createServiceClient()
  const orgId = getPublicEstimateOrgId()
  const externalLeadId = `public-estimate:${snapshot.jti}`
  const { path: customerPath, pricePerSquare } = resolvePublicEstimatePricingPath(snapshot)
  const disclaimer = getPublicEstimateDisclaimerForPath(customerPath)
  const pricing = computePublicEstimatePricing(snapshot.squares_mid, pricePerSquare)
  const price_low = pricing.price_low
  const price_high = pricing.price_high
  const squares_est = pricing.squares_mid
  const normalizedContact = { name, email, phone }
  const rawPayload = buildRawPayload({
    snapshot,
    customerPath,
    tokenExp,
    contact: normalizedContact,
    previewToken,
    pricePerSquare,
    price_low,
    price_high,
  })

  const existingByJti = await fetchLeadByExternalId(adminClient, orgId, externalLeadId)
  if (existingByJti?.id) {
    return handleExistingPublicEstimateLeadUnlock({
      adminClient,
      orgId,
      existing: existingByJti,
      snapshot,
      customerPath,
      contact: normalizedContact,
      rawPayload,
      price_low,
      price_high,
      squares_est,
      pricePerSquare,
      disclaimer,
    })
  }

  const estimateMode = customerPath === 'silent_manual' ? 'manual_design' : 'auto'
  const leadSourceName = getPublicEstimateLeadSourceName(customerPath === 'silent_manual')
  const leadSource = await ensurePublicEstimateLeadSource(adminClient, orgId, estimateMode)
  const ownerUserId =
    customerPath === 'silent_manual'
      ? null
      : (
          await resolveRevealPathOwnerAndLeadSource(
            adminClient,
            orgId,
            customerPath
          )
        ).ownerUserId

  if (customerPath !== 'silent_manual' && (!leadSource?.id || !ownerUserId)) {
    console.error('[public-estimate] reveal routing unavailable')
    return { ok: false, reason: 'reveal_routing_unavailable', status: 503 }
  }

  const leadData: Record<string, unknown> = {
    org_id: orgId,
    owner_user_id: ownerUserId,
    homeowner_name: name,
    phone,
    email,
    address_text: snapshot.address,
    lat: snapshot.lat,
    lng: snapshot.lng,
    source: leadSourceName,
    status: 'new',
    notes: buildEstimateNotes({
      snapshot,
      customerPath,
      price_low,
      price_high,
      pricePerSquare,
      disclaimer,
    }),
    lead_source_id: leadSource?.id || null,
    campaign_id: leadSource?.default_campaign_id || null,
    source_type: 'website',
    external_lead_id: externalLeadId,
    raw_payload: rawPayload,
  }

  const { lead, error: leadError } = await insertLeadWithSchemaFallback(adminClient, leadData)
  if (leadError?.code === '23505') {
    const raced = await fetchLeadByExternalId(adminClient, orgId, externalLeadId)
    if (raced?.id) {
      return handleExistingPublicEstimateLeadUnlock({
        adminClient,
        orgId,
        existing: raced,
        snapshot,
        customerPath,
        contact: normalizedContact,
        rawPayload,
        price_low,
        price_high,
        squares_est,
        pricePerSquare,
        disclaimer,
      })
    }
  }

  if (leadError || !lead) {
    const raced = await fetchLeadByExternalId(adminClient, orgId, externalLeadId)
    if (raced?.id) {
      return handleExistingPublicEstimateLeadUnlock({
        adminClient,
        orgId,
        existing: raced,
        snapshot,
        customerPath,
        contact: normalizedContact,
        rawPayload,
        price_low,
        price_high,
        squares_est,
        pricePerSquare,
        disclaimer,
      })
    }
    console.error('[public-estimate] lead insert failed:', leadError)
    return { ok: false, reason: 'lead_create_failed', status: 500 }
  }

  return finalizePublicEstimateUnlock({
    adminClient,
    leadId: lead.id,
    created: true,
    snapshot,
    customerPath,
    contact: normalizedContact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
    leadSource,
    ownerUserId,
  })
}
