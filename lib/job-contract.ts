/**
 * The signed contract(s) behind a production job, for the job sheets.
 *
 * Contract signing already copies part of the contract onto the job — scope checkboxes into
 * `projects.scope_of_work`, notes into `production_jobs.internal_notes`, exclusions into
 * `special_instructions` — but only when it creates a NEW project, and never `roofing_material` or
 * `additional_products`. So on 26-0046 the product ("IKO Harvard Slate") and the solar detach
 * ("Remove/Re-Install 46 Solar Panels") existed only on the contract, and ops retyped them.
 *
 * Found by the job's resolved proposal first (signing stamps `accepted_proposal_id` from
 * `contract.proposal_id`), then its resolved opportunity. Only `completed` contracts count —
 * pending ones were never signed and voided ones were replaced.
 *
 * NOTE: `/ops/jobs/[id]` still has two older contract lookups of its own (address-matched); see
 * Known Redundancy #12 in CLAUDE.md. Do not add a fourth — extend this one.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type JobSignedContract = {
  id: string
  signedAt: string | null
  agreementType: string | null
  pdfUrl: string | null
  roofingMaterial: string | null
  scopeOther: string | null
  additionalProducts: string | null
  exclusions: string | null
  /** Reference only — reps put payment/insurance terms here, so it never prints on a sheet. */
  notes: string | null
}

const CONTRACT_COLUMNS =
  'id, customer_signed_at, created_at, agreement_type, pdf_url, roofing_material, scope_other, additional_products, exclusions, notes'

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** "N/A" on a siding job's material line is the rep skipping the box, not a product. */
const PLACEHOLDER = /^(n\/?a|none|-+|tbd)$/i

function meaningful(value: unknown): string | null {
  const v = clean(value)
  return v && !PLACEHOLDER.test(v) ? v : null
}

/**
 * Removes dollar figures. The crew sheet carries no pricing and the supplier has no business
 * seeing it, but reps write prices into free-text fields ("Adding gutters - $1,395.20").
 */
export function stripDollarAmounts(text: string): string {
  return text
    .replace(/\s*[-–—:]?\s*\$\s?[\d,]+(?:\.\d{1,2})?/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function toContract(row: Record<string, any>): JobSignedContract {
  return {
    id: row.id,
    signedAt: row.customer_signed_at ?? row.created_at ?? null,
    agreementType: clean(row.agreement_type),
    pdfUrl: clean(row.pdf_url),
    roofingMaterial: meaningful(row.roofing_material),
    scopeOther: meaningful(row.scope_other),
    additionalProducts: meaningful(row.additional_products),
    exclusions: meaningful(row.exclusions),
    notes: clean(row.notes),
  }
}

export async function findJobSignedContracts(
  admin: SupabaseClient,
  orgId: string,
  ids: { proposalId: string | null; opportunityId: string | null }
): Promise<JobSignedContract[]> {
  const attempts: [string, string][] = []
  if (ids.proposalId) attempts.push(['proposal_id', ids.proposalId])
  if (ids.opportunityId) attempts.push(['opportunity_id', ids.opportunityId])

  for (const [column, value] of attempts) {
    const { data, error } = await admin
      .from('order_form_contracts')
      .select(CONTRACT_COLUMNS)
      .eq('org_id', orgId)
      .eq(column, value)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[Job contract] lookup failed:', error)
      return []
    }
    if (data && data.length > 0) return data.map(toContract)
  }
  return []
}

function distinct(values: (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** The product line as the customer signed for it. Joined when a split deal has two contracts. */
export function contractProductText(contracts: JobSignedContract[]): string | null {
  const parts = distinct(contracts.map((c) => c.roofingMaterial))
  return parts.length > 0 ? parts.join('\n') : null
}

/**
 * The contract's "additional products", as add-on lines. Skipped when a sold proposal adder
 * already names the same thing ("Gutters" vs the "Seamless Gutters" adder) so the crew isn't
 * told twice.
 */
export function contractAddOnLines(contracts: JobSignedContract[], adderNames: string[]): string[] {
  const adders = adderNames.map((n) => n.toLowerCase().trim()).filter(Boolean)
  const lines: string[] = []
  for (const text of distinct(contracts.map((c) => c.additionalProducts))) {
    const body = stripDollarAmounts(text)
    if (!body) continue
    const lower = body.toLowerCase()
    if (adders.some((a) => a.includes(lower) || lower.includes(a))) continue
    lines.push(body)
  }
  return lines
}
