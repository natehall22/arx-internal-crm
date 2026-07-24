import nodemailer from 'nodemailer'
import {
  getPublicEstimateDisclaimer,
  getPublicEstimateOrgId,
  getPublicEstimatePricePerSquare,
  PUBLIC_ESTIMATE_LEAD_SOURCE_NAME,
  PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE,
  isInPublicEstimateServiceArea,
} from '@/lib/public-estimate-config'
import type { PublicEstimatePreviewSnapshot } from '@/lib/public-estimate-preview-store'
import { getPublicEstimatePreview } from '@/lib/public-estimate-preview-store'
import { computePublicEstimatePricing } from '@/lib/public-estimate-pricing'
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
  email: string
): boolean {
  const normalized = email.trim().toLowerCase()
  if (!normalized.includes('@')) return false
  const emailedAt = rawPayload?.homeowner_estimate_emailed_at
  const emailedTo =
    typeof rawPayload?.homeowner_estimate_emailed_to === 'string'
      ? rawPayload.homeowner_estimate_emailed_to.trim().toLowerCase()
      : ''
  if (typeof emailedAt === 'string' && emailedAt && emailedTo === normalized) {
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
}): HomeownerEstimateEmailContent {
  const { name, address, price_low, price_high, squares_est, disclaimer } = options
  const range = `${formatUsd(price_low)}–${formatUsd(price_high)}`
  const subject = `Your ARX roof estimate for ${address}`
  const text = [
    `Hi ${name},`,
    '',
    'Thanks for using ARX Roofing\'s instant roof estimate.',
    '',
    `Property: ${address}`,
    `Estimated roofing range (shingles): ${range}`,
    `About ${squares_est} squares`,
    '',
    'This estimate is based on aerial/satellite imagery of your roof.',
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
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#2c2c2a">This estimate is based on aerial/satellite imagery of your roof.</p>
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

async function ensureWebsiteInstantEstimateLeadSource(adminClient: AdminClient, orgId: string) {
  // Live lead_sources has no notification_emails / notify_on_new_lead columns.
  // Keep selects/inserts aligned with production schema only.
  const sourceSelect =
    'id, org_id, name, source_type, default_campaign_id, field_mapping, auto_assign_user_id, webhook_enabled, is_active'

  const { data: existing } = await adminClient
    .from('lead_sources')
    .select(sourceSelect)
    .eq('org_id', orgId)
    .eq('name', PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
    .maybeSingle()

  if (existing) return existing

  // Prefer the same owner as Website Contact Form so routing matches other web leads.
  const { data: contactFormSource } = await adminClient
    .from('lead_sources')
    .select('auto_assign_user_id, default_campaign_id')
    .eq('org_id', orgId)
    .eq('name', 'Website Contact Form')
    .maybeSingle()

  const { data: org } = await adminClient.from('orgs').select('id, settings').eq('id', orgId).single()
  let autoAssign: string | null =
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

  const { data: created, error } = await adminClient
    .from('lead_sources')
    .insert({
      org_id: orgId,
      name: PUBLIC_ESTIMATE_LEAD_SOURCE_NAME,
      source_type: 'website',
      webhook_enabled: true,
      is_active: true,
      auto_assign_user_id: autoAssign,
      default_campaign_id: contactFormSource?.default_campaign_id || null,
    })
    .select(sourceSelect)
    .single()

  if (error) {
    const { data: raced } = await adminClient
      .from('lead_sources')
      .select(sourceSelect)
      .eq('org_id', orgId)
      .eq('name', PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
      .maybeSingle()
    if (raced) return raced
    console.error('[public-estimate] lead source create failed:', error)
    return null
  }

  return created
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

function buildEstimateNotes(options: {
  snapshot: PublicEstimatePreviewSnapshot
  price_low: number
  price_high: number
  pricePerSquare: number
  disclaimer: string
}): string {
  const { snapshot, price_low, price_high, pricePerSquare, disclaimer } = options
  if (snapshot.requires_manual_measure) {
    const measureDetail =
      snapshot.squares_mid > 0
        ? `Auto-measure unreliable (est. ${snapshot.squares_low}–${snapshot.squares_high} sq mid ${snapshot.squares_mid} — DO NOT quote customer)`
        : 'No reliable auto-measure from Solar/aerial — manual draw required'
    return [
      'Website Instant Estimate (manual measure required) — CALL IMMEDIATELY',
      `Address (locked from aerial preview): ${snapshot.address}`,
      measureDetail,
      `Waste ~${snapshot.waste_percent}% · source=${snapshot.measure_source} · facets=${snapshot.facet_count}`,
      '',
      'No dollar estimate shown to customer — designer must manually draw roof before quoting.',
      'Rep coaching: complex roof or missing Solar data; set expectation for designer follow-up; no-pressure clarifying questions.',
    ].join('\n')
  }
  return [
    'Website Instant Estimate (unlocked) — CALL IMMEDIATELY',
    `Address (locked from aerial preview): ${snapshot.address}`,
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

function buildRawPayload(options: {
  snapshot: PublicEstimatePreviewSnapshot
  tokenExp: number
  contact: PublicEstimateContact
  previewToken: string
  pricePerSquare: number
  price_low: number
  price_high: number
}): Record<string, unknown> {
  const { snapshot, tokenExp, contact, previewToken, pricePerSquare, price_low, price_high } = options
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
    estimate_mode: snapshot.requires_manual_measure ? 'manual_design' : 'auto',
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

async function fetchLeadByExternalId(
  adminClient: AdminClient,
  orgId: string,
  externalLeadId: string
): Promise<{ id: string } | null> {
  const { data } = await adminClient
    .from('leads')
    .select('id')
    .eq('org_id', orgId)
    .eq('external_lead_id', externalLeadId)
    .limit(1)
    .maybeSingle()
  return data?.id ? { id: data.id } : null
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
  leadSource: Awaited<ReturnType<typeof ensureWebsiteInstantEstimateLeadSource>>
  ownerUserId: string | null
  snapshot: PublicEstimatePreviewSnapshot
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
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  } = options
  const { name, email, phone } = contact
  const manual = snapshot.requires_manual_measure

  try {
    await adminClient.from('activities').insert({
      org_id: orgId,
      lead_id: leadId,
      user_id: ownerUserId,
      type: 'note',
      body: manual
        ? `Manual-measure website estimate unlocked — CALL NOW. Designer must draw roof · ${snapshot.address}`
        : `Instant website estimate unlocked — CALL NOW. ${formatUsd(price_low)}–${formatUsd(price_high)} · ${snapshot.address}`,
    })
  } catch (e) {
    console.log('[public-estimate] activity insert skipped:', e)
  }

  if (ownerUserId) {
    const notifBase = manual
      ? {
          org_id: orgId,
          type: 'new_lead',
          title: 'CALL NOW — Manual Measure Estimate',
          body: `${name} · ${phone} · ${snapshot.address}. Complex roof — no dollar estimate shown; designer must manually draw roof.`,
        }
      : {
          org_id: orgId,
          type: 'new_lead',
          title: 'CALL NOW — Website Instant Estimate',
          body: `${name} · ${phone} · ${snapshot.address} · ${formatUsd(price_low)}–${formatUsd(price_high)}. Estimate only (not a quote); complexity may change price; no-pressure follow-up.`,
        }
    try {
      await adminClient.from('notifications').insert({
        ...notifBase,
        recipient_user_id: ownerUserId,
        link_url: `/leads/${leadId}`,
      })
    } catch {
      try {
        await adminClient.from('notifications').insert({
          ...notifBase,
          user_id: ownerUserId,
          link_url: `/leads/${leadId}`,
          read: false,
        })
      } catch (e) {
        console.log('[public-estimate] notification insert skipped:', e)
      }
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
  const leadUrl = `${appUrl}/leads/${leadId}`
  // Primary internal alert inbox. Live lead_sources has no notification_emails column —
  // do not select/insert that field. Owner email is still added when auto-assigned.
  const emailRecipients = new Set<string>(['info@arxroofing.com'])
  const notifyEmails = (leadSource as { notification_emails?: unknown } | null)?.notification_emails
  if (Array.isArray(notifyEmails)) {
    for (const e of notifyEmails) {
      if (typeof e === 'string' && e.includes('@')) emailRecipients.add(e.trim().toLowerCase())
    }
  }
  if (ownerUserId) {
    const { data: owner } = await adminClient
      .from('users')
      .select('email')
      .eq('id', ownerUserId)
      .maybeSingle()
    if (owner?.email) emailRecipients.add(String(owner.email).toLowerCase())
  }

  try {
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      const transporter = getMailTransport()
      const subject = manual
        ? `CALL NOW — Manual Measure: ${name}`
        : `CALL NOW — Instant Estimate: ${name} (${formatUsd(price_low)}–${formatUsd(price_high)})`
      const text = manual
        ? [
            'A homeowner submitted a website roof request that needs a manual measure. Call immediately.',
            '',
            `Name: ${name}`,
            `Phone: ${phone}`,
            `Email: ${email}`,
            `Address: ${snapshot.address}`,
            `Measure source: ${snapshot.measure_source} · facets=${snapshot.facet_count}`,
            '',
            'No dollar estimate was shown — designer must manually draw roof before quoting.',
            '',
            `Lead: ${leadUrl}`,
          ].join('\n')
        : [
            'A homeowner just unlocked a website roof estimate. Call immediately.',
            '',
            `Name: ${name}`,
            `Phone: ${phone}`,
            `Email: ${email}`,
            `Address: ${snapshot.address}`,
            `Estimate shown: ${formatUsd(price_low)}–${formatUsd(price_high)} (est. ${squares_est} sq @ $${pricePerSquare}/sq shingles — roofing only)`,
            '',
            'Customer was told: estimate only (not a quote); based on roof complexity the price could be different; you will ask clarifying no-pressure questions.',
            disclaimer,
            '',
            `Lead: ${leadUrl}`,
          ].join('\n')
      await transporter.sendMail({
        from: 'info@arxroofing.com',
        to: Array.from(emailRecipients).join(', '),
        subject,
        text,
        html: manual
          ? `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
          <h2 style="color:#b45309;margin:0 0 12px">CALL NOW — Manual Measure Estimate</h2>
          <p style="color:#2c2c2a"><strong>${escapeHtml(name)}</strong> needs a manual roof measure.</p>
          <ul style="color:#2c2c2a">
            <li>Phone: <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a></li>
            <li>Email: ${escapeHtml(email)}</li>
            <li>Address: ${escapeHtml(snapshot.address)}</li>
            <li>Source: ${escapeHtml(snapshot.measure_source)} · ${snapshot.facet_count} facets</li>
          </ul>
          <p style="color:#2c2c2a;font-size:14px;line-height:1.45">No dollar estimate shown — designer must manually draw roof.</p>
          <p><a href="${escapeHtml(leadUrl)}" style="background:#b45309;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Open lead in CRM</a></p>
        </div>`
          : `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
          <h2 style="color:#b45309;margin:0 0 12px">CALL NOW — Website Instant Estimate</h2>
          <p style="color:#2c2c2a"><strong>${escapeHtml(name)}</strong> just unlocked their estimate.</p>
          <ul style="color:#2c2c2a">
            <li>Phone: <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a></li>
            <li>Email: ${escapeHtml(email)}</li>
            <li>Address: ${escapeHtml(snapshot.address)}</li>
            <li>Estimate: <strong>${escapeHtml(formatUsd(price_low))}–${escapeHtml(formatUsd(price_high))}</strong> (est. ${squares_est} squares · $${pricePerSquare}/sq shingles)</li>
          </ul>
          <p style="color:#2c2c2a;font-size:14px;line-height:1.45"><em>${escapeHtml(disclaimer)}</em></p>
          <p><a href="${escapeHtml(leadUrl)}" style="background:#b45309;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Open lead in CRM</a></p>
        </div>`,
      })
    }
  } catch (e) {
    console.error('[public-estimate] alert email failed:', e)
  }
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
  email: string
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
  contact: PublicEstimateContact
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
}): Promise<boolean> {
  const {
    adminClient,
    leadId,
    snapshot,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  } = options
  const { name, email } = contact

  try {
    const priorRaw = await fetchLeadRawPayload(adminClient, leadId)
    if (!shouldSendHomeownerEstimateEmail(priorRaw, email)) {
      return false
    }

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      console.log('[public-estimate] homeowner estimate email skipped: SMTP not configured')
      return false
    }

    const { subject, text, html } = snapshot.requires_manual_measure
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
        })

    const transporter = getMailTransport()
    await transporter.sendMail({
      from: 'info@arxroofing.com',
      to: email,
      subject,
      text,
      html,
    })

    await markHomeownerEstimateEmailed(adminClient, leadId, email)
    return true
  } catch (e) {
    console.error('[public-estimate] homeowner estimate email failed:', e)
    return false
  }
}

async function finalizePublicEstimateUnlock(options: {
  adminClient: AdminClient
  leadId: string
  created: boolean
  snapshot: PublicEstimatePreviewSnapshot
  contact: PublicEstimateContact
  price_low: number
  price_high: number
  squares_est: number
  pricePerSquare: number
  disclaimer: string
  leadSource: Awaited<ReturnType<typeof ensureWebsiteInstantEstimateLeadSource>>
  ownerUserId: string | null
}): Promise<PublicEstimateLeadResult> {
  const {
    adminClient,
    leadId,
    created,
    snapshot,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
    leadSource,
    ownerUserId,
  } = options

  if (created) {
    await sendNewPublicEstimateLeadAlerts({
      adminClient,
      orgId: getPublicEstimateOrgId(),
      leadId,
      leadSource,
      ownerUserId,
      snapshot,
      contact,
      price_low,
      price_high,
      squares_est,
      pricePerSquare,
      disclaimer,
    })
  }

  const estimate_emailed = await maybeSendHomeownerEstimateEmail({
    adminClient,
    leadId,
    snapshot,
    contact,
    price_low,
    price_high,
    squares_est,
    pricePerSquare,
    disclaimer,
  })

  if (snapshot.requires_manual_measure) {
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
  const pricePerSquare = getPublicEstimatePricePerSquare()
  const disclaimer = getPublicEstimateDisclaimer()
  const pricing = computePublicEstimatePricing(snapshot.squares_mid)
  const price_low = pricing.price_low
  const price_high = pricing.price_high
  const squares_est = pricing.squares_mid
  const normalizedContact = { name, email, phone }
  const rawPayload = buildRawPayload({
    snapshot,
    tokenExp,
    contact: normalizedContact,
    previewToken,
    pricePerSquare,
    price_low,
    price_high,
  })

  const existingByJti = await fetchLeadByExternalId(adminClient, orgId, externalLeadId)
  if (existingByJti?.id) {
    await refreshPublicEstimateLeadContact(adminClient, existingByJti.id, normalizedContact, rawPayload)
    return finalizePublicEstimateUnlock({
      adminClient,
      leadId: existingByJti.id,
      created: false,
      snapshot,
      contact: normalizedContact,
      price_low,
      price_high,
      squares_est,
      pricePerSquare,
      disclaimer,
      leadSource: null,
      ownerUserId: null,
    })
  }

  const leadSource = await ensureWebsiteInstantEstimateLeadSource(adminClient, orgId)
  const { data: org } = await adminClient.from('orgs').select('id, settings').eq('id', orgId).single()

  let ownerUserId: string | null =
    leadSource?.auto_assign_user_id || org?.settings?.web_leads_owner_id || null
  if (!ownerUserId) {
    const { data: adminUser } = await adminClient
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle()
    ownerUserId = adminUser?.id || null
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
    source: PUBLIC_ESTIMATE_LEAD_SOURCE_NAME,
    status: 'new',
    notes: buildEstimateNotes({ snapshot, price_low, price_high, pricePerSquare, disclaimer }),
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
      await refreshPublicEstimateLeadContact(adminClient, raced.id, normalizedContact, rawPayload)
      return finalizePublicEstimateUnlock({
        adminClient,
        leadId: raced.id,
        created: false,
        snapshot,
        contact: normalizedContact,
        price_low,
        price_high,
        squares_est,
        pricePerSquare,
        disclaimer,
        leadSource: null,
        ownerUserId: null,
      })
    }
  }

  if (leadError || !lead) {
    const raced = await fetchLeadByExternalId(adminClient, orgId, externalLeadId)
    if (raced?.id) {
      await refreshPublicEstimateLeadContact(adminClient, raced.id, normalizedContact, rawPayload)
      return finalizePublicEstimateUnlock({
        adminClient,
        leadId: raced.id,
        created: false,
        snapshot,
        contact: normalizedContact,
        price_low,
        price_high,
        squares_est,
        pricePerSquare,
        disclaimer,
        leadSource: null,
        ownerUserId: null,
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
