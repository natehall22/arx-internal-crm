import {
  PUBLIC_ESTIMATE_LEAD_SOURCE_NAME,
  PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME,
} from '@/lib/public-estimate-config'
import type { PublicEstimatePreviewSnapshot } from '@/lib/public-estimate-preview-store'
import {
  classifyPublicEstimateHomeownerBackfillKey,
  classifyPublicEstimateUnlockBackfillPath,
  createOrGetPublicEstimateLead,
  isLeadAlreadyOnRevealRouting,
  isLeadOnSilentManualRouting,
  leadNeedsRevealCrmReconcile,
  shouldPromoteExistingLeadToRevealPath,
  shouldSendHomeownerEstimateEmail,
} from '@/lib/public-estimate-lead'

const ORG_ID = '9089d4ad-f46c-405b-9798-6751d45a7051'
const INSIDE_SALES_USER_ID = 'inside-sales-user-id'
const LEAD_SOURCE_ID = 'lead-source-auto-id'

type LeadRow = {
  id: string
  org_id: string
  external_lead_id: string
  owner_user_id: string | null
  source: string | null
  lead_source_id: string | null
  campaign_id: string | null
  notes: string | null
  homeowner_name: string
  email: string
  phone: string
  address_text: string
  lat: number
  lng: number
  status: string
  source_type: string
  raw_payload: Record<string, unknown>
}

const leads = new Map<string, LeadRow>()
const activities: Record<string, unknown>[] = []
const notifications: Record<string, unknown>[] = []
const sentMail: { to: string; subject: string }[] = []
const deliveries = new Map<string, { state: 'claimed' | 'sent' | 'failed'; attemptId: string }>()
let reconcileUpdateShouldFail = false
let claimRpcUnavailable = false
let homeownerRevealEmailShouldFail = false

function resetStores() {
  leads.clear()
  activities.length = 0
  notifications.length = 0
  sentMail.length = 0
  deliveries.clear()
  reconcileUpdateShouldFail = false
  claimRpcUnavailable = false
  homeownerRevealEmailShouldFail = false
}

function seedManualMeasureLead(jti: string): LeadRow {
  const row: LeadRow = {
    id: `lead-${jti}`,
    org_id: ORG_ID,
    external_lead_id: `public-estimate:${jti}`,
    owner_user_id: null,
    source: PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME,
    lead_source_id: 'manual-source-id',
    campaign_id: null,
    notes:
      'Website Instant Estimate — Manual Measure (design team) — NOT routed to inside sales\nDO NOT quote customer',
    homeowner_name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '7045551212',
    address_text: 'Heritage Dr, Charlotte, NC',
    lat: 35.2,
    lng: -80.8,
    status: 'new',
    source_type: 'website',
    raw_payload: {
      funnel: 'website_instant_estimate',
      preview_jti: jti,
      pricing_mode: 'silent_manual',
      estimate_mode: 'manual_design',
      homeowner_estimate_emailed_at: '2026-07-01T12:00:00.000Z',
      homeowner_estimate_emailed_to: 'jane@example.com',
    },
  }
  leads.set(row.id, row)
  deliveries.set(`${row.id}:lead-activity:manual`, {
    state: 'sent',
    attemptId: 'seed-manual-activity',
  })
  deliveries.set(`${row.id}:ops-email:manual`, {
    state: 'sent',
    attemptId: 'seed-manual-ops-email',
  })
  deliveries.set(`${row.id}:homeowner-estimate:manual:jane@example.com`, {
    state: 'sent',
    attemptId: 'seed-manual-homeowner-email',
  })
  return row
}

/** Stale CRM columns after a prior refresh wrote reveal fields into raw_payload. */
function seedPartiallyPromotedLead(jti: string): LeadRow {
  const row = seedManualMeasureLead(jti)
  row.raw_payload = {
    ...row.raw_payload,
    pricing_mode: 'fallback_unreliable',
    estimate_mode: 'auto',
    price_low: 17_500,
    price_high: 22_500,
    price_per_square: 530,
    unlocked_at: '2026-07-01T12:05:00.000Z',
  }
  return row
}

jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: async (opts: { to: string; subject: string }) => {
      const isHomeownerReveal =
        opts.to === 'jane@example.com' && /Your ARX roof estimate/i.test(opts.subject)
      if (homeownerRevealEmailShouldFail && isHomeownerReveal) {
        throw new Error('SMTP send failed')
      }
      sentMail.push({ to: opts.to, subject: opts.subject })
    },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (
      name: string,
      args: { p_lead_id: string; p_delivery_key: string; p_attempt_id?: string }
    ) => {
      const deliveryId = `${args.p_lead_id}:${args.p_delivery_key}`
      if (name === 'claim_public_estimate_unlock_delivery') {
        if (claimRpcUnavailable) {
          return {
            data: null,
            error: {
              code: '42883',
              message: 'function claim_public_estimate_unlock_delivery does not exist',
            },
          }
        }
        const prior = deliveries.get(deliveryId)
        if (!prior || prior.state === 'failed') {
          const attemptId = `${deliveryId}:${deliveries.size + 1}`
          deliveries.set(deliveryId, { state: 'claimed', attemptId })
          return { data: attemptId, error: null }
        }
        return { data: null, error: null }
      }
      if (name === 'complete_public_estimate_unlock_delivery') {
        const prior = deliveries.get(deliveryId)
        if (prior?.state === 'claimed' && prior.attemptId === args.p_attempt_id) {
          deliveries.set(deliveryId, { ...prior, state: 'sent' })
        }
        return { data: null, error: null }
      }
      if (name === 'fail_public_estimate_unlock_delivery') {
        const prior = deliveries.get(deliveryId)
        if (prior?.state === 'claimed' && prior.attemptId === args.p_attempt_id) {
          deliveries.set(deliveryId, { ...prior, state: 'failed' })
        }
        return { data: null, error: null }
      }
      throw new Error(`unexpected rpc: ${name}`)
    },
    from: (table: string) => {
      if (table === 'leads') {
        return {
          select: (cols?: string) => ({
            eq: (col: string, val: string) => ({
              eq: (_col2: string, val2: string) => ({
                limit: (_n: number) => ({
                  maybeSingle: async () => {
                    if (col === 'org_id' && val === ORG_ID) {
                      const row = Array.from(leads.values()).find((l) => l.external_lead_id === val2)
                      if (!row) return { data: null, error: null }
                      return { data: pickLead(row, cols), error: null }
                    }
                    return { data: null, error: null }
                  },
                }),
              }),
              limit: (_n: number) => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => {
                if (col === 'id') {
                  const row = leads.get(val)
                  if (!row) return { data: null, error: null }
                  return { data: pickLead(row, cols), error: null }
                }
                return { data: null, error: null }
              },
            }),
          }),
          update: (patch: Partial<LeadRow>) => ({
            eq: (_col: string, id: string) => {
              const row = leads.get(id)
              if (row) {
                const isRevealReconcile =
                  patch.source === PUBLIC_ESTIMATE_LEAD_SOURCE_NAME &&
                  typeof patch.notes === 'string' &&
                  patch.notes.includes('CALL IMMEDIATELY')
                if (isRevealReconcile && reconcileUpdateShouldFail) {
                  return Promise.resolve({ error: { message: 'reconcile failed' } })
                }
                if (patch.raw_payload) {
                  row.raw_payload = {
                    ...row.raw_payload,
                    ...(patch.raw_payload as Record<string, unknown>),
                  }
                  delete (patch as { raw_payload?: unknown }).raw_payload
                }
                Object.assign(row, patch)
              }
              return Promise.resolve({ error: null })
            },
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { code: '23505' } }),
            }),
          }),
        }
      }

      if (table === 'lead_sources') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              eq: (_col2: string, name: string) => ({
                maybeSingle: async () => {
                  if (val !== ORG_ID) return { data: null, error: null }
                  if (name === PUBLIC_ESTIMATE_LEAD_SOURCE_NAME) {
                    return {
                      data: {
                        id: LEAD_SOURCE_ID,
                        auto_assign_user_id: INSIDE_SALES_USER_ID,
                        default_campaign_id: null,
                      },
                      error: null,
                    }
                  }
                  if (name === 'Website Contact Form') {
                    return {
                      data: {
                        auto_assign_user_id: INSIDE_SALES_USER_ID,
                        default_campaign_id: null,
                      },
                      error: null,
                    }
                  }
                  return { data: null, error: null }
                },
              }),
            }),
          }),
        }
      }

      if (table === 'orgs') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: ORG_ID, settings: { web_leads_owner_id: null } },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'users') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: (_col2: string, _val2: string) => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => {
                if (col === 'id' && val === INSIDE_SALES_USER_ID) {
                  return { data: { email: 'inside@arxroofing.com' }, error: null }
                }
                return { data: null, error: null }
              },
            }),
          }),
        }
      }

      if (table === 'activities') {
        return {
          insert: async (row: Record<string, unknown>) => {
            activities.push(row)
            return { error: null }
          },
        }
      }

      if (table === 'notifications') {
        return {
          insert: async (row: Record<string, unknown>) => {
            notifications.push(row)
            return { error: null }
          },
        }
      }

      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

function pickLead(row: LeadRow, cols?: string) {
  if (!cols || cols === '*') return { ...row }
  const out: Record<string, unknown> = {}
  for (const c of cols.split(',').map((s) => s.trim())) {
    if (c in row) out[c] = row[c as keyof LeadRow]
  }
  return out
}

function fallbackSnapshot(jti: string): PublicEstimatePreviewSnapshot {
  return {
    jti,
    address: 'Heritage Dr, Charlotte, NC',
    lat: 35.2,
    lng: -80.8,
    squares_mid: 39.1,
    squares_low: 33.2,
    squares_high: 45.0,
    waste_percent: 12,
    facet_count: 8,
    measure_source: 'solar_mask_whole',
    requires_manual_measure: true,
    expiresAt: Date.now() + 60_000,
  }
}

describe('public estimate idempotent unlock promotion', () => {
  beforeEach(() => {
    resetStores()
    process.env.PUBLIC_ESTIMATE_ORG_ID = ORG_ID
    process.env.SMTP_HOST = 'smtp.test'
    process.env.SMTP_USER = 'test@test.com'
    process.env.SMTP_PASS = 'pass'
    process.env.NEXT_PUBLIC_APP_URL = 'https://arx-internal-crm.vercel.app'
  })

  it('detects silent-manual routing on existing Manual Measure leads', () => {
    const row = seedManualMeasureLead('jti-detect')
    expect(isLeadOnSilentManualRouting(row)).toBe(true)
    expect(
      shouldPromoteExistingLeadToRevealPath('fallback_unreliable', {
        id: row.id,
        owner_user_id: row.owner_user_id,
        source: row.source,
        lead_source_id: row.lead_source_id,
        notes: row.notes,
        raw_payload: row.raw_payload,
      })
    ).toBe(true)
    expect(
      shouldPromoteExistingLeadToRevealPath('silent_manual', {
        id: row.id,
        owner_user_id: row.owner_user_id,
        source: row.source,
        lead_source_id: row.lead_source_id,
        notes: row.notes,
        raw_payload: row.raw_payload,
      })
    ).toBe(false)
  })

  it('prefers reveal raw_payload over stale source/notes for routing detection', () => {
    const row = seedPartiallyPromotedLead('jti-partial')
    expect(isLeadAlreadyOnRevealRouting(row.raw_payload)).toBe(true)
    expect(isLeadOnSilentManualRouting(row)).toBe(false)
    expect(
      shouldPromoteExistingLeadToRevealPath('fallback_unreliable', {
        id: row.id,
        owner_user_id: row.owner_user_id,
        source: row.source,
        lead_source_id: row.lead_source_id,
        notes: row.notes,
        raw_payload: row.raw_payload,
      })
    ).toBe(false)
  })

  it('classifies partial promotion as manual backfill so reveal recovery is not blocked', () => {
    const row = seedPartiallyPromotedLead('jti-backfill-partial')
    expect(classifyPublicEstimateUnlockBackfillPath(row)).toBe('manual')
    expect(classifyPublicEstimateHomeownerBackfillKey(row)).toBe(
      'homeowner-estimate:manual:jane@example.com'
    )
    expect(
      leadNeedsRevealCrmReconcile({
        id: row.id,
        owner_user_id: row.owner_user_id,
        source: row.source,
        lead_source_id: row.lead_source_id,
        notes: row.notes,
        raw_payload: row.raw_payload,
      })
    ).toBe(true)
    expect(shouldSendHomeownerEstimateEmail(row.raw_payload, row.email, 'reveal')).toBe(true)
  })

  it('classifies fully promoted reveal leads as reveal backfill', () => {
    const row = seedPartiallyPromotedLead('jti-backfill-reveal')
    row.source = PUBLIC_ESTIMATE_LEAD_SOURCE_NAME
    row.owner_user_id = INSIDE_SALES_USER_ID
    row.notes =
      'Website Instant Estimate (unlocked) — CALL IMMEDIATELY\nEst. range shown to customer: $17,500–$22,500'
    row.raw_payload = {
      ...row.raw_payload,
      homeowner_estimate_email_mode: 'reveal',
    }
    expect(classifyPublicEstimateUnlockBackfillPath(row)).toBe('reveal')
    expect(classifyPublicEstimateHomeownerBackfillKey(row)).toBe(
      'homeowner-estimate:reveal:jane@example.com'
    )
  })

  it('delivers the missing promotion alert once when reveal payload is stale but CRM routing is manual', async () => {
    const jti = 'jti-partial-retry'
    seedPartiallyPromotedLead(jti)
    const snapshot = fallbackSnapshot(jti)

    const result = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-partial',
    })

    expect(result.ok).toBe(true)
    const lead = leads.get(`lead-${jti}`)!
    expect(lead.owner_user_id).toBe(INSIDE_SALES_USER_ID)
    expect(lead.source).toBe(PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
    expect(lead.notes).toMatch(/CALL IMMEDIATELY/)
    expect(activities).toHaveLength(1)
    expect(notifications).toHaveLength(1)
    expect(sentMail.filter((m) => m.subject.match(/CALL NOW/i))).toHaveLength(1)
  })

  it('retries failed reconcile and delivers the first successful promotion once', async () => {
    const jti = 'jti-reconcile-retry'
    seedManualMeasureLead(jti)
    reconcileUpdateShouldFail = true
    const snapshot = fallbackSnapshot(jti)

    const first = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-reconcile-retry-1',
    })
    expect(first).toEqual({ ok: false, reason: 'reveal_reconcile_failed', status: 503 })
    expect(activities).toHaveLength(0)

    reconcileUpdateShouldFail = false
    const second = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-reconcile-retry-2',
    })
    expect(second.ok).toBe(true)

    const lead = leads.get(`lead-${jti}`)!
    expect(lead.owner_user_id).toBe(INSIDE_SALES_USER_ID)
    expect(lead.source).toBe(PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
    expect(activities).toHaveLength(1)
    expect(notifications).toHaveLength(1)
    expect(sentMail.filter((m) => m.subject.match(/CALL NOW/i))).toHaveLength(1)
  })

  it('does not send promotion alerts when reveal reconcile fails', async () => {
    const jti = 'jti-reconcile-fail'
    seedManualMeasureLead(jti)
    reconcileUpdateShouldFail = true
    const snapshot = fallbackSnapshot(jti)

    const result = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-reconcile-fail',
    })

    expect(result).toEqual({ ok: false, reason: 'reveal_reconcile_failed', status: 503 })
    const lead = leads.get(`lead-${jti}`)!
    expect(lead.raw_payload.pricing_mode).toBe('silent_manual')
    expect(lead.raw_payload.estimate_mode).toBe('manual_design')
    expect(lead.source).toBe(PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME)
    expect(activities).toHaveLength(0)
    expect(notifications).toHaveLength(0)
    expect(sentMail.filter((m) => m.subject.match(/CALL NOW/i))).toHaveLength(0)
  })

  it('promotes Manual Measure lead to fallback_unreliable with owner + alerts once', async () => {
    const jti = 'jti-promote-once'
    seedManualMeasureLead(jti)
    const snapshot = fallbackSnapshot(jti)

    const first = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-test',
    })

    expect(first.ok).toBe(true)
    if (!first.ok) return

    const lead = leads.get(`lead-${jti}`)!
    expect(lead.owner_user_id).toBe(INSIDE_SALES_USER_ID)
    expect(lead.source).toBe(PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
    expect(lead.lead_source_id).toBe(LEAD_SOURCE_ID)
    expect(lead.notes).toMatch(/CALL IMMEDIATELY/)
    expect(lead.notes).toMatch(/\$530\/sq FALLBACK/)
    expect(lead.notes).not.toMatch(/DO NOT quote/)
    expect(lead.raw_payload.pricing_mode).toBe('fallback_unreliable')
    expect(lead.raw_payload.estimate_mode).toBe('auto')

    expect(activities).toHaveLength(1)
    expect(String(activities[0].body)).toMatch(/CALL NOW/)
    expect(notifications).toHaveLength(1)
    expect(sentMail.some((m) => m.subject.match(/CALL NOW/i))).toBe(true)
    expect(sentMail.some((m) => m.to.includes('jane@example.com'))).toBe(true)

    const activityCountAfterFirst = activities.length
    const notificationCountAfterFirst = notifications.length
    const mailCountAfterFirst = sentMail.length

    const second = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-test',
    })

    expect(second.ok).toBe(true)
    expect(activities).toHaveLength(activityCountAfterFirst)
    expect(notifications).toHaveLength(notificationCountAfterFirst)
    expect(sentMail).toHaveLength(mailCountAfterFirst)
    expect(lead.owner_user_id).toBe(INSIDE_SALES_USER_ID)
    expect(lead.source).toBe(PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
  })

  it('promotes Manual Measure lead to fallback_complex with $550/sq notes once', async () => {
    const jti = 'jti-promote-complex'
    seedManualMeasureLead(jti)
    const snapshot: PublicEstimatePreviewSnapshot = {
      ...fallbackSnapshot(jti),
      facet_count: 12,
    }

    const first = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-complex',
    })

    expect(first.ok).toBe(true)
    if (!first.ok) return

    const lead = leads.get(`lead-${jti}`)!
    expect(lead.raw_payload.pricing_mode).toBe('fallback_complex')
    expect(lead.notes).toMatch(/\$550\/sq COMPLEX FALLBACK/)
    expect(lead.notes).not.toMatch(/\$530\/sq FALLBACK/)
  })

  it('does not duplicate promotion alerts or homeowner reveal email for concurrent unlocks', async () => {
    const jti = 'jti-promote-concurrent'
    seedManualMeasureLead(jti)
    const snapshot = fallbackSnapshot(jti)
    const unlock = () =>
      createOrGetPublicEstimateLead({
        snapshot,
        tokenExp: Math.floor(Date.now() / 1000) + 3600,
        contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
        previewToken: 'preview-token-prefix-concurrent',
      })

    const [first, second] = await Promise.all([unlock(), unlock()])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(activities).toHaveLength(1)
    expect(notifications).toHaveLength(1)
    expect(sentMail.filter((m) => m.subject.match(/CALL NOW/i))).toHaveLength(1)
    expect(sentMail.filter((m) => m.to === 'jane@example.com')).toHaveLength(1)
  })

  it('delivers promotion alerts when delivery-state claim RPC is unavailable (fail-open)', async () => {
    const jti = 'jti-claim-rpc-missing'
    seedManualMeasureLead(jti)
    claimRpcUnavailable = true
    const snapshot = fallbackSnapshot(jti)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-claim-rpc-missing',
    })

    expect(result.ok).toBe(true)
    expect(activities).toHaveLength(1)
    expect(String(activities[0].body)).toMatch(/CALL NOW/)
    expect(notifications).toHaveLength(1)
    expect(sentMail.filter((m) => m.subject.match(/CALL NOW/i))).toHaveLength(1)
    expect(sentMail.some((m) => m.to.includes('jane@example.com'))).toBe(true)
    expect(
      consoleSpy.mock.calls.some((call) =>
        String(call[0]).includes('unlock delivery-state RPC unavailable')
      )
    ).toBe(true)
    expect(
      consoleSpy.mock.calls.some((call) => String(call[0]).includes('idempotency is degraded'))
    ).toBe(true)

    consoleSpy.mockRestore()
  })

  it('retries failed reveal homeowner email after silent-manual promotion', async () => {
    const jti = 'jti-reveal-email-retry'
    seedManualMeasureLead(jti)
    homeownerRevealEmailShouldFail = true
    const snapshot = fallbackSnapshot(jti)

    const first = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-reveal-retry-1',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.estimate_emailed).toBe(false)

    const revealDelivery = deliveries.get(`${`lead-${jti}`}:homeowner-estimate:reveal:jane@example.com`)
    expect(revealDelivery?.state).toBe('failed')
    expect(sentMail.filter((m) => /Your ARX roof estimate/i.test(m.subject))).toHaveLength(0)
    expect(sentMail.filter((m) => m.subject.match(/CALL NOW/i))).toHaveLength(1)

    const leadAfterFirst = leads.get(`lead-${jti}`)!
    expect(leadAfterFirst.raw_payload.homeowner_estimate_email_mode).toBeUndefined()
    expect(leadAfterFirst.raw_payload.pricing_mode).toBe('fallback_unreliable')

    homeownerRevealEmailShouldFail = false
    const second = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-reveal-retry-2',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.estimate_emailed).toBe(true)

    const revealEmails = sentMail.filter((m) => /Your ARX roof estimate/i.test(m.subject))
    expect(revealEmails).toHaveLength(1)
    expect(revealEmails[0].to).toBe('jane@example.com')

    const leadAfterSecond = leads.get(`lead-${jti}`)!
    expect(leadAfterSecond.raw_payload.homeowner_estimate_email_mode).toBe('reveal')

    const activityCountAfterSecond = activities.length
    const mailCountAfterSecond = sentMail.length

    const third = await createOrGetPublicEstimateLead({
      snapshot,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '7045551212' },
      previewToken: 'preview-token-prefix-reveal-retry-3',
    })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.estimate_emailed).toBe(false)
    expect(activities).toHaveLength(activityCountAfterSecond)
    expect(sentMail).toHaveLength(mailCountAfterSecond)
    expect(sentMail.filter((m) => /Your ARX roof estimate/i.test(m.subject))).toHaveLength(1)
  })
})
