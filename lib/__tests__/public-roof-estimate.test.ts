import {
  PUBLIC_ESTIMATE_DISCLAIMER,
  PUBLIC_ESTIMATE_GATE_COPY,
  PUBLIC_ESTIMATE_PRICE_PER_SQUARE,
  PUBLIC_ESTIMATE_RANGE_BAND,
  getPublicEstimateDisclaimer,
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
  buildHomeownerEstimateEmailContent,
  buildHomeownerManualDesignEmailContent,
  shouldSendHomeownerEstimateEmail,
} from '@/lib/public-estimate-lead'
import { isPublicEstimateManualMeasureRequired } from '@/lib/public-estimate-manual-measure'
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

describe('public estimate mail From', () => {
  const prevFrom = process.env.SMTP_FROM

  afterEach(() => {
    if (prevFrom === undefined) delete process.env.SMTP_FROM
    else process.env.SMTP_FROM = prevFrom
  })

  it('uses SMTP_FROM when it already targets info@', () => {
    process.env.SMTP_FROM = 'ARX Roofing <info@arxroofing.com>'
    expect(getPublicEstimateMailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
  })

  it('falls back to branded info@ when SMTP_FROM is missing or not info@', () => {
    delete process.env.SMTP_FROM
    expect(getPublicEstimateMailFrom()).toBe('ARX Roofing <info@arxroofing.com>')
    process.env.SMTP_FROM = 'nathan@arxroofing.com'
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
