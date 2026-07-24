import { getCrmEmailFrom } from '@/lib/crm-email-from'
import {
  PUBLIC_ESTIMATE_DISCLAIMER,
  PUBLIC_ESTIMATE_GATE_COPY,
  PUBLIC_ESTIMATE_LEAD_SOURCE_NAME,
  PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME,
  PUBLIC_ESTIMATE_PRICE_PER_SQUARE,
  PUBLIC_ESTIMATE_RANGE_BAND,
  getPublicEstimateDisclaimer,
  getPublicEstimateLeadSourceName,
  getPublicEstimateMailFrom,
  getPublicEstimatePricePerSquare,
  getPublicTurnstileSiteKey,
  isInPublicEstimateServiceArea,
} from '@/lib/public-estimate-config'
import { computePublicEstimatePricing } from '@/lib/public-estimate-pricing'
import {
  getPublicEstimatePreview,
  resetPublicEstimatePreviewStoreForTests,
  storePublicEstimatePreview,
} from '@/lib/public-estimate-preview-store'
import {
  applyEstimateRange,
  createPublicEstimateToken,
  verifyPublicEstimateToken,
} from '@/lib/public-estimate-token'
import {
  buildEstimateNotes,
  buildHomeownerEstimateEmailContent,
  buildHomeownerManualDesignEmailContent,
  buildOpsAlertEmailContent,
  resolvePublicEstimateOwnerUserId,
  shouldSendHomeownerEstimateEmail,
} from '@/lib/public-estimate-lead'
import { isPublicEstimateManualMeasureRequired } from '@/lib/public-estimate-manual-measure'
import {
  classifySolarMaskAttempt,
  maskAttemptFromClassification,
  selectPublicEstimateMeasure,
} from '@/lib/public-estimate-measure-select'
import {
  consumePublicEstimateRateLimit,
  resetPublicEstimateRateLimitForTests,
} from '@/lib/public-estimate-rate-limit'

const previewRows = new Map<string, Record<string, unknown>>()

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'public_estimate_previews') {
        throw new Error(`unexpected table in public estimate tests: ${table}`)
      }
      return {
        upsert: async (row: Record<string, unknown>) => {
          previewRows.set(String(row.jti), row)
          return { error: null }
        },
        select: (_cols?: string) => ({
          eq: (_col: string, jti: string) => ({
            gt: (_col2: string, nowIso: string) => ({
              maybeSingle: async () => {
                const row = previewRows.get(jti)
                if (!row) return { data: null, error: null }
                if (String(row.expires_at) <= nowIso) {
                  previewRows.delete(jti)
                  return { data: null, error: null }
                }
                return { data: row, error: null }
              },
            }),
          }),
        }),
        delete: () => ({
          eq: async (_col: string, jti: string) => {
            previewRows.delete(jti)
            return { error: null }
          },
          neq: async () => {
            previewRows.clear()
            return { error: null }
          },
        }),
      }
    },
  }),
}))

describe('public estimate pricing ($413/sq fixed)', () => {
  it('uses $413 per square by default', () => {
    expect(PUBLIC_ESTIMATE_PRICE_PER_SQUARE).toBe(413)
    expect(getPublicEstimatePricePerSquare()).toBe(413)
  })

  it('builds a ±15% dollar range from squares × $413', () => {
    const pricing = computePublicEstimatePricing(28)
    expect(pricing.price_per_square).toBe(413)
    expect(pricing.price_mid).toBe(Math.round(28 * 413))
    expect(pricing.price_low).toBe(applyEstimateRange(pricing.price_mid, PUBLIC_ESTIMATE_RANGE_BAND).low)
    expect(pricing.price_high).toBe(applyEstimateRange(pricing.price_mid, PUBLIC_ESTIMATE_RANGE_BAND).high)
    expect(pricing.price_low).toBeLessThan(pricing.price_mid)
    expect(pricing.price_high).toBeGreaterThan(pricing.price_mid)
  })
})

describe('public estimate token', () => {
  const secret = 'test-public-estimate-secret-thirty-two-chars'

  it('signs only jti + exp so preview cannot leak measurement data', () => {
    const token = createPublicEstimateToken('jti-uuid-1', { secret, now: 1_000_000 })
    const verified = verifyPublicEstimateToken(token, { secret, now: 1_000_100 })
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.jti).toBe('jti-uuid-1')
    expect(verified.payload.exp).toBeGreaterThan(1_000_000)

    const body = token.split('.')[0]
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(decoded.jti).toBe('jti-uuid-1')
    expect(decoded.squares_mid).toBeUndefined()
    expect(decoded.address).toBeUndefined()
    expect(decoded.lat).toBeUndefined()
  })

  it('rejects tampered tokens and expired tokens', () => {
    const token = createPublicEstimateToken('jti-uuid-2', { secret, now: 1_000_000, ttlMs: 1000 })
    expect(verifyPublicEstimateToken(token + 'x', { secret, now: 1_000_100 }).ok).toBe(false)
    expect(verifyPublicEstimateToken(token, { secret, now: 1_002_000 }).ok).toBe(false)
  })
})

describe('public estimate preview store', () => {
  beforeEach(async () => {
    await resetPublicEstimatePreviewStoreForTests()
    process.env.PUBLIC_ESTIMATE_ORG_ID = '9089d4ad-f46c-405b-9798-6751d45a7051'
  })

  it('stores measurement snapshots server-side keyed by jti', async () => {
    const snapshot = await storePublicEstimatePreview(
      {
        jti: 'preview-jti-1',
        address: '123 Main St, Charlotte, NC 28202',
        lat: 35.2271,
        lng: -80.8431,
        squares_mid: 28.5,
        squares_low: 24.2,
        squares_high: 32.8,
        waste_percent: 12,
        facet_count: 4,
        measure_source: 'solar_mask',
        requires_manual_measure: false,
      },
      { now: 1_000_000, ttlMs: 60_000 }
    )
    expect(snapshot.expiresAt).toBe(1_060_000)

    const loaded = await getPublicEstimatePreview('preview-jti-1', { now: 1_000_500 })
    expect(loaded?.squares_mid).toBe(28.5)
    expect(loaded?.address).toContain('Charlotte')
    expect(await getPublicEstimatePreview('preview-jti-1', { now: 1_060_001 })).toBeNull()
  })
})

describe('public estimate service area', () => {
  it('accepts Charlotte and rejects far-away coordinates', () => {
    expect(isInPublicEstimateServiceArea(35.2271, -80.8431)).toBe(true)
    expect(isInPublicEstimateServiceArea(40.7128, -74.006)).toBe(false)
  })
})

describe('public estimate turnstile site key config', () => {
  const prevSite = process.env.TURNSTILE_SITE_KEY
  const prevAlias = process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY
  const prevVite = process.env.VITE_TURNSTILE_SITE_KEY

  afterEach(() => {
    if (prevSite === undefined) delete process.env.TURNSTILE_SITE_KEY
    else process.env.TURNSTILE_SITE_KEY = prevSite
    if (prevAlias === undefined) delete process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY
    else process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY = prevAlias
    if (prevVite === undefined) delete process.env.VITE_TURNSTILE_SITE_KEY
    else process.env.VITE_TURNSTILE_SITE_KEY = prevVite
  })

  it('returns null when unset', () => {
    delete process.env.TURNSTILE_SITE_KEY
    delete process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY
    delete process.env.VITE_TURNSTILE_SITE_KEY
    expect(getPublicTurnstileSiteKey()).toBeNull()
  })

  it('prefers TURNSTILE_SITE_KEY over the alias', () => {
    process.env.TURNSTILE_SITE_KEY = 'site-primary'
    process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY = 'site-alias'
    process.env.VITE_TURNSTILE_SITE_KEY = 'site-vite-legacy'
    expect(getPublicTurnstileSiteKey()).toBe('site-primary')
  })

  it('falls back to PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY', () => {
    delete process.env.TURNSTILE_SITE_KEY
    process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY = 'site-alias'
    delete process.env.VITE_TURNSTILE_SITE_KEY
    expect(getPublicTurnstileSiteKey()).toBe('site-alias')
  })

  it('falls back to legacy VITE_TURNSTILE_SITE_KEY', () => {
    delete process.env.TURNSTILE_SITE_KEY
    delete process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY
    process.env.VITE_TURNSTILE_SITE_KEY = 'site-vite-legacy'
    expect(getPublicTurnstileSiteKey()).toBe('site-vite-legacy')
  })
})

describe('CRM / public estimate mail From', () => {
  const prevFrom = process.env.SMTP_FROM

  afterEach(() => {
    if (prevFrom === undefined) delete process.env.SMTP_FROM
    else process.env.SMTP_FROM = prevFrom
  })

  it('uses SMTP_FROM when it already targets info@', () => {
    process.env.SMTP_FROM = 'ARX Roofing <info@arxroofing.com>'
    expect(getCrmEmailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
    expect(getPublicEstimateMailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
  })

  it('falls back to branded info@ when SMTP_FROM is missing or not info@', () => {
    delete process.env.SMTP_FROM
    expect(getCrmEmailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
    process.env.SMTP_FROM = 'nathan@arxroofing.com'
    expect(getCrmEmailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
    expect(getPublicEstimateMailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
  })
})

describe('public estimate disclaimer copy', () => {
  it('includes estimate-only, complexity, and no-pressure language', () => {
    expect(PUBLIC_ESTIMATE_DISCLAIMER).toMatch(/estimate only/i)
    expect(PUBLIC_ESTIMATE_DISCLAIMER).toMatch(/not a quote/i)
    expect(PUBLIC_ESTIMATE_DISCLAIMER).toMatch(/complexity/i)
    expect(PUBLIC_ESTIMATE_DISCLAIMER).toMatch(/no-pressure/i)
    expect(PUBLIC_ESTIMATE_GATE_COPY).toMatch(/estimate only/i)
    expect(PUBLIC_ESTIMATE_GATE_COPY).toMatch(/no-pressure/i)
  })

  it('does not expose $413 or per-square rate to customers', () => {
    const disclaimer = getPublicEstimateDisclaimer()
    expect(disclaimer).not.toMatch(/\$413/)
    expect(disclaimer).not.toMatch(/per square/i)
    expect(disclaimer).not.toMatch(/\$\d+\s*\/\s*sq/i)
    expect(PUBLIC_ESTIMATE_DISCLAIMER).not.toMatch(/\$413/)
    expect(PUBLIC_ESTIMATE_DISCLAIMER).not.toMatch(/per square/i)
  })
})

describe('public estimate rate limit', () => {
  beforeEach(() => resetPublicEstimateRateLimitForTests())

  it('allows up to the limit then blocks', () => {
    const key = 'test-ip'
    for (let i = 0; i < 3; i++) {
      expect(consumePublicEstimateRateLimit({ key, limit: 3, windowMs: 60_000, now: 1000 }).ok).toBe(true)
    }
    const blocked = consumePublicEstimateRateLimit({ key, limit: 3, windowMs: 60_000, now: 1000 })
    expect(blocked.ok).toBe(false)
  })
})

describe('public estimate manual measure detection', () => {
  it('flags no_roof_data and complex roofs', () => {
    expect(isPublicEstimateManualMeasureRequired({ no_roof_data: true })).toBe(true)
    expect(isPublicEstimateManualMeasureRequired({ facet_count: 7, measure_source: 'solar_mask' })).toBe(
      true
    )
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 8, measure_source: 'solar_mask' })
    ).toBe(true)
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 5, measure_source: 'solar_segments' })
    ).toBe(true)
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 6, measure_source: 'solar_segments' })
    ).toBe(true)
  })

  it('allows simple auto-estimate roofs', () => {
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 4, measure_source: 'solar_mask' })
    ).toBe(false)
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 6, measure_source: 'solar_mask' })
    ).toBe(false)
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 4, measure_source: 'solar_segments' })
    ).toBe(false)
  })

  it('forces manual on whole-mask reconcile disagreement', () => {
    expect(
      isPublicEstimateManualMeasureRequired({
        facet_count: 2,
        measure_source: 'solar_mask_whole',
        force_manual_reconcile: true,
      })
    ).toBe(true)
  })

  it('solar_reconciled ignores segments≥5 when mask facets are simple', () => {
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 2, measure_source: 'solar_reconciled' })
    ).toBe(false)
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 6, measure_source: 'solar_reconciled' })
    ).toBe(false)
    expect(
      isPublicEstimateManualMeasureRequired({ facet_count: 7, measure_source: 'solar_reconciled' })
    ).toBe(true)
  })
})

describe('public estimate dual-measure reconcile', () => {
  const maskFacets = [
    {
      id: 'm0',
      vertices: [] as [number, number][],
      lat_lng_vertices: [
        { lat: 35.48, lng: -80.59 },
        { lat: 35.48, lng: -80.589 },
        { lat: 35.479, lng: -80.589 },
      ],
      confidence: 0.9,
      estimated_sq_ft: 900,
      solar_segment_index: 0,
      suggested_pitch_degrees: 25,
      suggested_azimuth_degrees: null,
      suggested_ground_area_sqft: 800,
      suggested_sloped_area_sqft: null,
      plane_height_at_center_meters: null,
      facet_source: 'solar_mask_plane',
    },
  ]

  const wholeFacets = maskFacets.map((f) => ({ ...f, facet_source: 'solar_mask_whole' }))

  const bundle = (baseSquares: number, facetCount: number) => ({
    baseSquares,
    facetCount,
    avgPitchMultiplier: 1.12,
  })

  it.each([
    {
      name: 'relaxed_split undercover (Duke-class) → segments, auto',
      classification: 'relaxed_split' as const,
      facets: maskFacets,
      M: 9.1,
      S: 12.8,
      segmentCount: 6,
      maskFacetCount: 2,
      expectSource: 'solar_reconciled',
      expectBase: 12.8,
      expectManual: false,
      expectReason: 'relaxed_split_reconcile_to_segments',
    },
    {
      name: 'quality_split without undercover → mask',
      classification: 'quality_split' as const,
      facets: maskFacets,
      M: 12.0,
      S: 12.5,
      segmentCount: 2,
      maskFacetCount: 2,
      expectSource: 'solar_mask',
      expectBase: 12.0,
      expectManual: false,
      expectReason: 'quality_split_use_mask',
    },
    {
      name: 'quality_split undercover → segments reconciled',
      classification: 'quality_split' as const,
      facets: maskFacets,
      M: 8.0,
      S: 12.0,
      segmentCount: 2,
      maskFacetCount: 2,
      expectSource: 'solar_reconciled',
      expectBase: 12.0,
      expectManual: false,
      expectReason: 'quality_split_undercover_reconcile_to_segments',
    },
    {
      name: 'whole agrees (low rel, seg<5) → mask whole',
      classification: 'whole' as const,
      facets: wholeFacets,
      M: 12.0,
      S: 12.5,
      segmentCount: 4,
      maskFacetCount: 1,
      expectSource: 'solar_mask_whole',
      expectBase: 12.0,
      expectManual: false,
      expectReason: 'whole_mask_agrees_with_segments',
    },
    {
      name: 'whole high rel → force manual, price segments for ops',
      classification: 'whole' as const,
      facets: wholeFacets,
      M: 16.0,
      S: 12.0,
      segmentCount: 4,
      maskFacetCount: 1,
      expectSource: 'solar_mask_whole',
      expectBase: 12.0,
      expectManual: true,
      expectReason: 'whole_mask_segment_disagree_rel',
    },
    {
      name: 'whole seg≥5 → force manual even if rel low',
      classification: 'whole' as const,
      facets: wholeFacets,
      M: 12.5,
      S: 12.8,
      segmentCount: 5,
      maskFacetCount: 1,
      expectSource: 'solar_mask_whole',
      expectBase: 12.8,
      expectManual: true,
      expectReason: 'whole_mask_segment_disagree_seg_count',
    },
    {
      name: 'no mask → segments only',
      classification: 'none' as const,
      facets: [],
      M: null,
      S: 11.0,
      segmentCount: 4,
      maskFacetCount: null,
      expectSource: 'solar_segments',
      expectBase: 11.0,
      expectManual: false,
      expectReason: 'no_mask_segments_only',
    },
    {
      name: 'segments only ≥5 facets → manual',
      classification: 'none' as const,
      facets: [],
      M: null,
      S: 14.0,
      segmentCount: 5,
      maskFacetCount: null,
      expectSource: 'solar_segments',
      expectBase: 14.0,
      expectManual: true,
      expectReason: 'no_mask_segments_only',
    },
  ])(
    '$name',
    ({
      classification,
      facets,
      M,
      S,
      segmentCount,
      maskFacetCount,
      expectSource,
      expectBase,
      expectManual,
      expectReason,
    }) => {
      const maskAttempt =
        classification === 'none'
          ? { facets: null, reason: 'no_roof_pixels' as const, details: {} }
          : maskAttemptFromClassification(classification, facets)

      expect(classifySolarMaskAttempt(maskAttempt)).toBe(classification)

      const selection = selectPublicEstimateMeasure({
        maskAttempt,
        maskSquares: M != null ? bundle(M, maskFacetCount ?? 1) : null,
        segmentSquares: S != null ? bundle(S, segmentCount) : null,
        segmentCount,
      })

      expect(selection).not.toBeNull()
      expect(selection!.measure_source).toBe(expectSource)
      expect(selection!.chosen.baseSquares).toBeCloseTo(expectBase, 1)
      expect(selection!.measure_select_reason).toBe(expectReason)

      const manual = isPublicEstimateManualMeasureRequired({
        measure_source: selection!.measure_source,
        facet_count: selection!.chosen.facetCount,
        force_manual_reconcile: selection!.force_manual_reconcile,
      })
      expect(manual).toBe(expectManual)
    }
  )
})

describe('homeowner estimate email', () => {
  it('dedupes repeat unlocks for the same email but resends after typo fix', () => {
    const raw = {
      homeowner_estimate_emailed_at: '2026-07-22T12:00:00.000Z',
      homeowner_estimate_emailed_to: 'home@example.com',
    }
    expect(shouldSendHomeownerEstimateEmail(raw, 'home@example.com')).toBe(false)
    expect(shouldSendHomeownerEstimateEmail(raw, 'fixed@example.com')).toBe(true)
    expect(shouldSendHomeownerEstimateEmail(null, 'home@example.com')).toBe(true)
  })

  it('escapes user-controlled fields and uses estimate language', () => {
    const { subject, html, text } = buildHomeownerEstimateEmailContent({
      name: 'Jane <script>',
      email: 'jane@example.com',
      address: '123 Main & Co, Charlotte, NC',
      price_low: 9800,
      price_high: 13200,
      squares_est: 28,
      disclaimer: getPublicEstimateDisclaimer(),
    })
    expect(subject).toBe('Your ARX roof estimate for 123 Main & Co, Charlotte, NC')
    expect(html).toContain('Jane &lt;script&gt;')
    expect(html).toContain('123 Main &amp; Co, Charlotte, NC')
    expect(html).not.toContain('<script>')
    expect(html).toContain('About 28 squares')
    expect(html).not.toMatch(/\$413/)
    expect(text).not.toMatch(/\$413/)
    expect(html).not.toMatch(/per square/i)
    expect(text).not.toMatch(/per square/i)
    expect(html).not.toMatch(/\$413\/sq/)
    expect(text).not.toMatch(/\$413\/sq/)
    expect(subject).toMatch(/estimate/i)
    expect(subject).not.toMatch(/roof quote/i)
    expect(html).toMatch(/estimate/i)
    expect(text).toMatch(/estimate/i)
    expect(text).toMatch(/An ARX team member will call you shortly/)
  })

  it('uses request-received copy for manual design path (no dollars)', () => {
    const { subject, html, text } = buildHomeownerManualDesignEmailContent({
      name: 'Jane Doe',
      address: '123 Main St, Charlotte, NC',
    })
    expect(subject).toMatch(/received your roof request/i)
    expect(html).toMatch(/manual measure/i)
    expect(text).not.toMatch(/\$/)
    expect(text).toMatch(/design team/i)
  })
})

describe('public estimate manual vs auto lead routing', () => {
  it('uses a distinct lead source name for manual measure', () => {
    expect(getPublicEstimateLeadSourceName(false)).toBe(PUBLIC_ESTIMATE_LEAD_SOURCE_NAME)
    expect(getPublicEstimateLeadSourceName(true)).toBe(PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME)
    expect(PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME).toMatch(/Manual Measure/)
  })

  it('never auto-assigns owner on manual/complex path', () => {
    expect(
      resolvePublicEstimateOwnerUserId({
        requiresManualMeasure: true,
        leadSourceAutoAssignUserId: 'inside-sales-user',
        webLeadsOwnerId: 'web-owner',
        fallbackAdminUserId: 'admin',
      })
    ).toBeNull()
  })

  it('keeps inside-sales auto_assign on auto estimate path', () => {
    expect(
      resolvePublicEstimateOwnerUserId({
        requiresManualMeasure: false,
        leadSourceAutoAssignUserId: 'inside-sales-user',
        webLeadsOwnerId: 'web-owner',
        fallbackAdminUserId: 'admin',
      })
    ).toBe('inside-sales-user')
  })

  it('tags manual notes for unassigned Leads pickup (not CALL NOW)', () => {
    const notes = buildEstimateNotes({
      snapshot: {
        jti: 'test',
        address: '1 Main St',
        lat: 35.2,
        lng: -80.8,
        squares_mid: 0,
        squares_low: 0,
        squares_high: 0,
        waste_percent: 15,
        facet_count: 12,
        measure_source: 'none',
        requires_manual_measure: true,
        expiresAt: Date.now() + 60_000,
      },
      price_low: 0,
      price_high: 0,
      pricePerSquare: 413,
      disclaimer: PUBLIC_ESTIMATE_DISCLAIMER,
    })
    expect(notes).toMatch(/NOT routed to inside sales/i)
    expect(notes).toMatch(/unassigned in Leads/i)
    expect(notes).not.toMatch(/CALL IMMEDIATELY/)
  })

  it('ops alert for manual path says no estimate / complex roof, not CALL NOW', () => {
    const { subject, text, html } = buildOpsAlertEmailContent({
      manual: true,
      name: 'Jane Doe',
      phone: '7045551212',
      email: 'jane@example.com',
      address: '1 Main St, Charlotte, NC',
      measure_source: 'none',
      facet_count: 14,
      leadUrl: 'https://arx-internal-crm.vercel.app/leads/abc',
      price_low: 0,
      price_high: 0,
      squares_est: 0,
      pricePerSquare: 413,
      disclaimer: PUBLIC_ESTIMATE_DISCLAIMER,
    })
    expect(subject).toMatch(/no estimate generated/i)
    expect(subject).toMatch(/Complex roof/i)
    expect(subject).not.toMatch(/CALL NOW/i)
    expect(text).toMatch(/complex roofing system/i)
    expect(text).toMatch(/No estimate was generated/i)
    expect(text).toMatch(/NOT auto-assigned to inside sales/i)
    expect(text).toMatch(/unassigned in Leads/i)
    expect(html).toMatch(/no estimate generated/i)
    expect(html).not.toMatch(/CALL NOW/i)
  })

  it('ops alert for auto path keeps CALL NOW + dollar range', () => {
    const { subject, text } = buildOpsAlertEmailContent({
      manual: false,
      name: 'Jane Doe',
      phone: '7045551212',
      email: 'jane@example.com',
      address: '1 Main St, Charlotte, NC',
      measure_source: 'solar',
      facet_count: 4,
      leadUrl: 'https://arx-internal-crm.vercel.app/leads/abc',
      price_low: 10000,
      price_high: 14000,
      squares_est: 28,
      pricePerSquare: 413,
      disclaimer: PUBLIC_ESTIMATE_DISCLAIMER,
    })
    expect(subject).toMatch(/^CALL NOW/)
    expect(subject).toMatch(/\$10,000/)
    expect(text).toMatch(/Call immediately/i)
  })
})
