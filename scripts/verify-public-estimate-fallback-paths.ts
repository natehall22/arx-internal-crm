/**
 * Verify Instant Estimate fallback path scorecard (no emails, no DB writes).
 * Usage: npx tsx scripts/verify-public-estimate-fallback-paths.ts [--heritage]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getPublicEstimateDisclaimerForPath,
  getPublicEstimateGateCopyForPath,
  getPublicEstimatePreviewMessageForPath,
  getPublicEstimateUnlockNextStepForPath,
} from '@/lib/public-estimate-config'
import {
  buildEstimateNotes,
  buildHomeownerEstimateEmailContent,
  buildHomeownerManualDesignEmailContent,
  buildOpsAlertEmailContent,
  resolvePublicEstimateOwnerUserId,
} from '@/lib/public-estimate-lead'
import {
  classifyPublicEstimateCustomerPath,
  computePublicEstimatePricing,
  resolvePublicEstimatePricingPath,
  type PublicEstimateCustomerPath,
} from '@/lib/public-estimate-pricing'
import { measurePublicRoofEstimate } from '@/lib/public-roof-estimate'

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

type ScorecardRow = {
  label: string
  path: PublicEstimateCustomerPath
  pricePerSquare: number
  price_low: number
  price_high: number
  squares_mid: number
  dollarsToCustomer: boolean
  complexCopy: boolean
  insideSalesRouted: boolean
  emailMode: 'range' | 'manual_design'
  requiresManualMeasureFlag: boolean
  gateHasComplexLanguage: boolean
  customerNoPerSq: boolean
  opsFallbackLabel: boolean
}

function isHybridFallbackCustomerCopy(text: string): boolean {
  return /conservative estimate range|manually measure your roof|looks complex from satellite|looks complex —/i.test(
    text
  )
}

function isSilentManualCustomerCopy(text: string): boolean {
  return /manual measure by our design team|will not show an instant dollar range/i.test(text)
}

function scoreSyntheticSnapshot(
  label: string,
  input: {
    requires_manual_measure: boolean
    squares_mid: number
    facet_count: number
    address?: string
  }
): ScorecardRow {
  const path = classifyPublicEstimateCustomerPath(input)
  const { pricePerSquare } = resolvePublicEstimatePricingPath(input)
  const pricing = computePublicEstimatePricing(input.squares_mid, pricePerSquare)
  const disclaimer = getPublicEstimateDisclaimerForPath(path)
  const gate = getPublicEstimateGateCopyForPath(path)
  const previewMsg = getPublicEstimatePreviewMessageForPath(path)
  const nextStep = getPublicEstimateUnlockNextStepForPath(path)
  const owner = resolvePublicEstimateOwnerUserId({
    customerPath: path,
    leadSourceAutoAssignUserId: 'inside-sales-user',
    webLeadsOwnerId: null,
    fallbackAdminUserId: null,
  })

  const customerTexts: string[] = [gate, previewMsg, nextStep, disclaimer]
  if (path === 'silent_manual') {
    const manual = buildHomeownerManualDesignEmailContent({
      name: 'Test',
      address: input.address || '1 Main St',
    })
    customerTexts.push(manual.text, manual.html)
  } else {
    const email = buildHomeownerEstimateEmailContent({
      name: 'Test',
      email: 'test@example.com',
      address: input.address || '1 Main St',
      price_low: pricing.price_low,
      price_high: pricing.price_high,
      squares_est: pricing.squares_mid,
      disclaimer,
      customerPath: path,
    })
    customerTexts.push(email.text, email.html)
  }

  const ops =
    path === 'silent_manual'
      ? buildOpsAlertEmailContent({
          customerPath: path,
          name: 'Test',
          phone: '7045551212',
          email: 'test@example.com',
          address: input.address || '1 Main St',
          measure_source: 'none',
          facet_count: input.facet_count,
          leadUrl: 'https://example/leads/1',
          price_low: 0,
          price_high: 0,
          squares_est: 0,
          pricePerSquare,
          disclaimer,
        })
      : buildOpsAlertEmailContent({
          customerPath: path,
          name: 'Test',
          phone: '7045551212',
          email: 'test@example.com',
          address: input.address || '1 Main St',
          measure_source: 'solar_mask_whole',
          facet_count: input.facet_count,
          leadUrl: 'https://example/leads/1',
          price_low: pricing.price_low,
          price_high: pricing.price_high,
          squares_est: pricing.squares_mid,
          pricePerSquare,
          disclaimer,
        })

  void buildEstimateNotes({
    snapshot: {
      jti: 'verify',
      address: input.address || '1 Main St',
      lat: 35.2,
      lng: -80.8,
      squares_mid: input.squares_mid,
      squares_low: pricing.squares_low,
      squares_high: pricing.squares_high,
      waste_percent: 12,
      facet_count: input.facet_count,
      measure_source: 'solar_mask_whole',
      requires_manual_measure: input.requires_manual_measure,
      expiresAt: Date.now() + 60_000,
    },
    customerPath: path,
    price_low: pricing.price_low,
    price_high: pricing.price_high,
    pricePerSquare,
    disclaimer,
  })

  const hasHybridFallbackLanguage = customerTexts.some(isHybridFallbackCustomerCopy)
  const hasSilentManualLanguage = customerTexts.some(isSilentManualCustomerCopy)
  const customerNoPerSq = customerTexts.every(
    (t) => !/\$530|\$550|\$413|per square|\$\/sq/i.test(t)
  )

  const opsFallbackLabel =
    path === 'fallback_unreliable'
      ? /\$530\/sq FALLBACK/.test(ops.text)
      : path === 'fallback_complex'
        ? /\$550\/sq COMPLEX FALLBACK/.test(ops.text)
        : path === 'auto'
          ? !/\$530\/sq FALLBACK|\$550\/sq COMPLEX FALLBACK/.test(ops.text)
          : !/CALL NOW/i.test(ops.subject)

  const expectedHybridCopy = path === 'fallback_unreliable' || path === 'fallback_complex'

  return {
    label,
    path,
    pricePerSquare,
    price_low: pricing.price_low,
    price_high: pricing.price_high,
    squares_mid: pricing.squares_mid,
    dollarsToCustomer: path !== 'silent_manual' && pricing.price_low > 0,
    complexCopy:
      path === 'auto'
        ? !hasHybridFallbackLanguage && !hasSilentManualLanguage
        : path === 'silent_manual'
          ? hasSilentManualLanguage && !hasHybridFallbackLanguage
          : hasHybridFallbackLanguage && expectedHybridCopy,
    insideSalesRouted: path !== 'silent_manual' && owner !== null,
    emailMode: path === 'silent_manual' ? 'manual_design' : 'range',
    requiresManualMeasureFlag: path === 'silent_manual',
    gateHasComplexLanguage:
      path === 'auto'
        ? !/manually measure/i.test(gate)
        : path === 'silent_manual'
          ? /will not show an instant dollar range/i.test(gate)
          : /conservative estimate range/i.test(gate) && /manually measure/i.test(gate),
    customerNoPerSq,
    opsFallbackLabel,
  }
}

async function scoreHeritageLive(): Promise<ScorecardRow | null> {
  const address = '2300 Heritage Ct, Kannapolis, NC 28083, USA'
  const measured = await measurePublicRoofEstimate(address)
  if (!measured.ok) {
    console.error('Heritage measure failed:', measured.reason)
    return null
  }
  const r = measured.result
  return scoreSyntheticSnapshot('Heritage Ct live measure', {
    requires_manual_measure: r.requires_manual_measure,
    squares_mid: r.squares_mid,
    facet_count: r.facet_count,
    address: r.address,
  })
}

async function main() {
  loadEnvLocal()
  const runHeritage = process.argv.includes('--heritage')

  const synthetic: ScorecardRow[] = [
    scoreSyntheticSnapshot('reliable auto', {
      requires_manual_measure: false,
      squares_mid: 28,
      facet_count: 4,
    }),
    scoreSyntheticSnapshot('fallback_unreliable (Heritage-class)', {
      requires_manual_measure: true,
      squares_mid: 39.1,
      facet_count: 8,
      address: '2300 Heritage Ct, Kannapolis, NC 28083, USA',
    }),
    scoreSyntheticSnapshot('fallback_complex (facet≥10)', {
      requires_manual_measure: true,
      squares_mid: 39.1,
      facet_count: 12,
    }),
    scoreSyntheticSnapshot('silent_manual (no squares)', {
      requires_manual_measure: true,
      squares_mid: 0,
      facet_count: 14,
    }),
  ]

  console.log('\n=== Synthetic scorecard ===')
  console.table(synthetic)

  if (runHeritage) {
    if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
      console.error('Skipping Heritage live measure: GOOGLE_MAPS_API_KEY not set')
      process.exit(1)
    }
    console.log('\n=== Heritage Ct live measure ===')
    const heritage = await scoreHeritageLive()
    if (heritage) {
      console.table([heritage])
      if (heritage.path !== 'fallback_unreliable') {
        console.error(`Expected fallback_unreliable, got ${heritage.path}`)
        process.exit(1)
      }
      if (heritage.pricePerSquare !== 530) {
        console.error(`Expected $530/sq, got ${heritage.pricePerSquare}`)
        process.exit(1)
      }
    } else {
      process.exit(1)
    }
  }

  const failures = synthetic.filter((row) => {
    if (row.path === 'auto') {
      return (
        !row.dollarsToCustomer ||
        row.insideSalesRouted !== true ||
        row.emailMode !== 'range' ||
        row.requiresManualMeasureFlag !== false ||
        !row.customerNoPerSq ||
        !row.complexCopy
      )
    }
    if (row.path === 'silent_manual') {
      return (
        row.dollarsToCustomer ||
        row.insideSalesRouted !== false ||
        row.emailMode !== 'manual_design' ||
        !row.complexCopy ||
        !row.customerNoPerSq
      )
    }
    // paid fallbacks
    return (
      !row.dollarsToCustomer ||
      !row.complexCopy ||
      row.insideSalesRouted !== true ||
      row.emailMode !== 'range' ||
      row.requiresManualMeasureFlag !== false ||
      !row.gateHasComplexLanguage ||
      !row.customerNoPerSq ||
      !row.opsFallbackLabel
    )
  })

  if (failures.length > 0) {
    console.error('\nSynthetic scorecard failures:', failures)
    process.exit(1)
  }
  console.log('\nAll synthetic scorecard checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
