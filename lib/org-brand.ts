/**
 * Company identity (name, phone, website, service area…) — the ONE reader.
 *
 * Precedence per field: name/phone/email/address come from their `orgs` column; legalName/shortName/website/serviceArea
 * and the two contract spellings (no column) from `orgs.settings.brand`; either way a missing value → the fallback.
 * Blank / whitespace-only strings count as missing.
 *
 * Fallback: DEFAULT_ORG_BRAND is NEUTRAL (blank; a missing legal/short name falls back to the company name). Until
 * the original company's identity is stored on its org row (data fix supabase/data-fixes/2026-11-10_arx_brand_into_org_row.sql),
 * a deployment WITHOUT the `DEPLOYMENT_ORG_ID` fence (= the original company's prod today) keeps its strings as the
 * fallback (`legacyBrandFallback`), so its output stays byte-identical. Every other company's copy sets
 * DEPLOYMENT_ORG_ID (docs/multi-company-plan.md slice 8) and never sees them. Delete LEGACY_ORG_BRAND and the gate once
 * the data fix is applied and that deployment sets DEPLOYMENT_ORG_ID. Do not add another copy of these strings anywhere.
 *
 * Customer documents show the owning rep's phone when it is dialable, else the company phone (`contactPhone`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { mergeOrgSettings } from '@/lib/org-settings'

import { formatPhone, formatPhoneDashed, telHref } from '@/lib/format'

export interface OrgBrand {
  /** Display name, e.g. report footers and email headers. */
  name: string
  /** Legal entity name for invoices and contracts, e.g. "Company, LLC". */
  legalName: string
  /** Short wordmark shown before the rest of the name. */
  shortName: string
  /** Company phone — what customers see when the rep has no phone on file. */
  phone: string
  /** Customer-facing email. */
  email: string
  /** Website as shown to customers (no protocol needed). */
  website: string
  /** Service-area line, e.g. "City / City, ST". */
  serviceArea: string
  /** Office address (multi-line). */
  address: string
  /** Legal name as contracts / change orders spell it, when that differs from `legalName` (`settings.brand`). */
  documentLegalName?: string
  /** Office address as contracts spell it, when that differs from `address` (`settings.brand`, multi-line). */
  documentAddress?: string
  /** Short region name for sentences ("outside our service area (… and nearby)"), when it differs from serviceArea. */
  serviceRegion?: string
}

/** Neutral fallback: nothing about any real company. A seeded org (scripts/seed-company.ts) never needs it. */
export const DEFAULT_ORG_BRAND: Readonly<OrgBrand> = Object.freeze({
  name: '',
  legalName: '',
  shortName: '',
  phone: '',
  email: '',
  website: '',
  serviceArea: '',
  address: '',
})

/**
 * LEGACY — the exact strings the CRM printed before identity moved onto the org row (the original company's), plus the
 * spellings its contracts used. Only the fallback while `legacyBrandFallback()` is on. Delete with the gate.
 */
const LEGACY_ORG_BRAND: Readonly<Required<OrgBrand>> = (() => {
  const base = {
    name: 'ARX Roofing & Exteriors',
    legalName: 'ARX Roofing & Exteriors, LLC',
    shortName: 'ARX',
    phone: '(704) 313-8834',
    email: 'info@arxroofing.com',
    website: 'arxroofing.com',
    serviceArea: 'Charlotte / Kannapolis, NC',
    address: '4101 Woodbury Ter NW\nConcord, NC 28027',
  }
  return Object.freeze({
    ...base,
    // contracts: "…Exteriors LLC" with no comma, "Terrace" written out
    documentLegalName: base.legalName.replace(/, (LLC)$/, ' $1'),
    documentAddress: '4101 Woodbury Terrace NW\nConcord, NC 28027',
    serviceRegion: 'Charlotte metro',
  })
})()

/**
 * True while this deployment has no `DEPLOYMENT_ORG_ID` fence — today only the original company's prod (and local dev/tests). Then a
 * missing brand field falls back to the original company's strings, exactly as before; with the fence it is neutral.
 * Server env only: in browser bundles it is always true, so client code must not resolve a brand itself.
 */
export function legacyBrandFallback(): boolean {
  return !process.env.DEPLOYMENT_ORG_ID?.trim()
}

/** The always-present fields (the optional contract spellings are resolved separately). */
type CoreBrandKey = Exclude<keyof OrgBrand, 'documentLegalName' | 'documentAddress' | 'serviceRegion'>
const ORG_BRAND_KEYS = Object.keys(DEFAULT_ORG_BRAND) as CoreBrandKey[]

/** Fields that are real `orgs` columns (edited as Company Name / Phone / Email / Address). The column always wins. */
const COLUMN_BACKED = ['name', 'phone', 'email', 'address'] as const
type ColumnBackedKey = (typeof COLUMN_BACKED)[number]

/** The only keys stored under `orgs.settings.brand` — fields with no `orgs` column. */
export const BRAND_SETTINGS_KEYS = ['legalName', 'shortName', 'website', 'serviceArea', 'documentLegalName', 'documentAddress', 'serviceRegion'] as const
export type BrandSettingsKey = (typeof BRAND_SETTINGS_KEYS)[number]

/** Longest value a brand field may hold (characters, after trimming). */
export const BRAND_FIELD_MAX = 120

function isColumnBacked(key: CoreBrandKey): key is ColumnBackedKey {
  return (COLUMN_BACKED as readonly string[]).includes(key)
}

export interface OrgBrandRow {
  name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  settings?: { brand?: unknown; [key: string]: unknown } | null
  /** `settings->brand` when selected directly (see getOrgBrand). */
  brand?: unknown
}

function present(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function brandObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Pure: resolve every identity field for an org row (null row → the fallback). */
export function resolveOrgBrand(row: OrgBrandRow | null | undefined): OrgBrand {
  const legacy = legacyBrandFallback()
  const fallback: Readonly<OrgBrand> = legacy ? LEGACY_ORG_BRAND : DEFAULT_ORG_BRAND
  const stored = brandObject(row?.brand ?? row?.settings?.brand)
  const out = {} as OrgBrand
  for (const key of ORG_BRAND_KEYS) {
    // column-backed fields never read settings.brand (a stale copy there must not override the column)
    const value = isColumnBacked(key) ? present(row?.[key]) : present(stored[key])
    out[key] = value ?? (fallback[key] as string)
  }
  if (!legacy) {
    // neutral: a company that stored only its name still prints its name, not a blank
    if (!present(stored.legalName)) out.legalName = out.name
    if (!present(stored.shortName)) out.shortName = out.name
  }
  // Contract spellings: stored ones win; the legacy fallback keeps the original company's while its value is the default.
  const documentLegalName =
    present(stored.documentLegalName) ??
    (legacy && out.legalName === LEGACY_ORG_BRAND.legalName ? LEGACY_ORG_BRAND.documentLegalName : null)
  const documentAddress =
    present(stored.documentAddress) ??
    (legacy && out.address === LEGACY_ORG_BRAND.address ? LEGACY_ORG_BRAND.documentAddress : null)
  const serviceRegion =
    present(stored.serviceRegion) ??
    (legacy && out.serviceArea === LEGACY_ORG_BRAND.serviceArea ? LEGACY_ORG_BRAND.serviceRegion : null)
  if (documentLegalName) out.documentLegalName = documentLegalName
  if (documentAddress) out.documentAddress = documentAddress
  if (serviceRegion) out.serviceRegion = serviceRegion
  return out
}

/** An org's brand plus whether it really came from the org row (`ok: false` → the defaults were used). */
export interface OrgBrandResult {
  brand: OrgBrand
  ok: boolean
}

async function readOrgBrandRow(client: SupabaseClient, orgId: string): Promise<OrgBrandRow | null> {
  const { data, error } = await client
    .from('orgs')
    .select('name, phone, email, address, brand:settings->brand')
    .eq('id', orgId)
    .maybeSingle()
  if (error) throw error
  return (data as OrgBrandRow | null) ?? null
}

/**
 * Load and resolve an org's brand. Never throws: a failed read is retried once, then logged and the defaults are
 * returned with `ok: false` so callers that must not act on the defaults (e.g. sending to the company inbox) can tell.
 */
export async function getOrgBrandResult(client: SupabaseClient, orgId: string | null | undefined): Promise<OrgBrandResult> {
  if (!orgId) return { brand: resolveOrgBrand(null), ok: false }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const row = await readOrgBrandRow(client, orgId)
      if (row) return { brand: resolveOrgBrand(row), ok: true }
      console.error('getOrgBrand: org row not found, using defaults', orgId)
      return { brand: resolveOrgBrand(null), ok: false }
    } catch (e) {
      lastError = e
    }
  }
  console.error('getOrgBrand: org row not readable after retry, using defaults', orgId, lastError)
  return { brand: resolveOrgBrand(null), ok: false }
}

/** Load and resolve an org's brand (defaults when it can't be read). Never throws. */
export async function getOrgBrand(client: SupabaseClient, orgId: string | null | undefined): Promise<OrgBrand> {
  return (await getOrgBrandResult(client, orgId)).brand
}

/**
 * "a" or "an" before the short name ("an Apex team member", "a Summit team member"): "an" when it starts with a
 * vowel letter, or is an all-caps initialism whose first letter is said with a vowel sound (F → "eff", M → "em"…).
 */
export function shortNameArticle(shortName: string, sentenceStart = false): string {
  const word = shortName.trim().split(/\s+/)[0] ?? ''
  const vowelSound =
    /^[aeiou]/i.test(word) || (/^[A-Z]{2,}$/.test(word.replace(/[^A-Za-z]/g, '')) && /^[AEFHILMNORSX]/.test(word))
  const article = vowelSound ? 'an' : 'a'
  return sentenceStart ? article[0].toUpperCase() + article.slice(1) : article
}

/** Phone a customer document shows: the owning rep's (formatted) when it is a dialable number, else the company phone (as stored). */
export function contactPhone(brand: Pick<OrgBrand, 'phone'>, repPhone?: string | null): string {
  const rep = present(repPhone)
  return rep && telHref(rep) ? formatPhone(rep) : brand.phone
}

/** An active user's phone (users.phone) in this org, or null when unknown, deactivated, deleted or another org's. */
export async function getUserPhone(
  client: SupabaseClient,
  userId: string | null | undefined,
  orgId: string | null | undefined
): Promise<string | null> {
  if (!userId || !orgId) return null
  const { data } = await client.from('users').select('phone, active').eq('id', userId).eq('org_id', orgId).maybeSingle()
  if (!data || data.active === false) return null
  return present(data.phone)
}

export type BrandPatch = Partial<Record<BrandSettingsKey, unknown>>

/**
 * Pure: what a brand patch does to `settings.brand` — `set` the trimmed (≤ BRAND_FIELD_MAX) values, `remove`
 * the keys sent blank (they fall back to the default). Only BRAND_SETTINGS_KEYS count; column keys
 * (name/phone/email/address) and unknown keys are ignored. Keys not in the patch are untouched.
 */
export function brandPatchOps(patch: unknown): { set: Partial<Record<BrandSettingsKey, string>>; remove: BrandSettingsKey[] } {
  const p = brandObject(patch)
  const set: Partial<Record<BrandSettingsKey, string>> = {}
  const remove: BrandSettingsKey[] = []
  for (const key of BRAND_SETTINGS_KEYS) {
    if (!(key in p)) continue
    const v = present(p[key])
    if (v === null) remove.push(key)
    else set[key] = v.slice(0, BRAND_FIELD_MAX).trim()
  }
  return { set, remove }
}

/** Pure: apply a brand patch to the stored `settings.brand` object (other stored keys are kept). */
export function mergeBrandSettings(current: unknown, patch: unknown): Record<string, unknown> {
  const { set, remove } = brandPatchOps(patch)
  const next: Record<string, unknown> = { ...brandObject(current) }
  for (const key of remove) delete next[key]
  return { ...next, ...set }
}

/** Admin → Settings → General form field → `settings.brand` key. */
export const GENERAL_BRAND_FIELDS = {
  brand_legal_name: 'legalName',
  brand_short_name: 'shortName',
  brand_website: 'website',
  brand_service_area: 'serviceArea',
} as const satisfies Record<string, BrandSettingsKey>

/** Pure: the brand fields present in a General-settings PATCH body, or null when it sent none. */
export function brandPatchFromGeneral(data: Record<string, unknown>): BrandPatch | null {
  const patch: BrandPatch = {}
  for (const [field, key] of Object.entries(GENERAL_BRAND_FIELDS)) {
    if (field in data) patch[key] = data[field]
  }
  return Object.keys(patch).length ? patch : null
}

/**
 * Pure: the derived spellings a General save makes stale — a new legal name (sent in the brand patch) clears
 * `documentLegalName`, a new service area clears `serviceRegion`; a changed address column clears `documentAddress`. Null when nothing is stale. Without this a
 * stored contract spelling would keep printing the old name/address after an owner edits it.
 */
export function staleDocumentSpellings(brandPatch: BrandPatch | null, newAddress: unknown, currentAddress: unknown): BrandPatch | null {
  const patch: BrandPatch = {}
  if (brandPatch && 'legalName' in brandPatch) patch.documentLegalName = ''
  if (brandPatch && 'serviceArea' in brandPatch) patch.serviceRegion = ''
  if (newAddress !== undefined && present(newAddress) !== present(currentAddress)) patch.documentAddress = ''
  return Object.keys(patch).length ? patch : null
}

/** Pure: whole new `orgs.settings` with a brand patch applied; every other settings key is kept. */
/** Only "the function does not exist yet" falls back (lives with the one settings writer, lib/org-settings.ts). */
export { isMissingFunction } from '@/lib/org-settings'

/**
 * Write a brand patch into `orgs.settings.brand`, touching only the patched keys, through the one per-key settings
 * writer (`mergeOrgSettings`, SQL `merge_org_settings` with path ['brand']) so a concurrent save of another settings
 * key is never overwritten. Until that migration is applied it falls back to read → merge → write of the same keys.
 */
export async function saveBrandSettings(
  client: SupabaseClient,
  orgId: string,
  patch: BrandPatch
): Promise<{ error: string | null }> {
  const { set, remove } = brandPatchOps(patch)
  if (!Object.keys(set).length && !remove.length) return { error: null }
  return mergeOrgSettings(client, orgId, set, { path: ['brand'], remove })
}

/** The part of the name after the short wordmark ("Roofing & Exteriors"), or null when it doesn't start with it. */
export function brandNameRest(brand: Pick<OrgBrand, 'name' | 'shortName'>): string | null {
  const prefix = `${brand.shortName} `
  return brand.name.startsWith(prefix) ? brand.name.slice(prefix.length) : null
}

/** Service area without a trailing ", ST" state code ("City / City"), for "across the … area" copy. */
export function brandServiceRegion(brand: Pick<OrgBrand, 'serviceArea'>): string {
  return brand.serviceArea.replace(/,\s*[A-Z]{2}\s*$/, '')
}

/** Absolute URL for the website field (stored with or without a protocol); '' when there is no website. */
export function brandWebsiteHref(brand: Pick<OrgBrand, 'website'>): string {
  const site = brand.website.trim()
  if (!site) return ''
  return /^https?:\/\//i.test(site) ? site : `https://${site}`
}

/**
 * Contract / change-order / signing-page letterhead spellings, derived from the brand. A company whose contracts spell
 * its legal name or address differently from its other documents stores that under `settings.brand.documentLegalName`
 * / `documentAddress` (e.g. "…Exteriors LLC" with no comma, "Terrace" written out). Otherwise the brand prints as
 * stored (address lines joined with ", ", phone dashed when it is a 10-digit US number).
 */
export interface DocumentBrand {
  /** "Company Name" — signature blocks, greetings. */
  name: string
  /** "COMPANY NAME" — email banners. */
  nameUpper: string
  /** Legal entity as contracts print it ("Company Name LLC"). */
  legalName: string
  /** "COMPANY NAME LLC" — letterhead title. */
  legalNameUpper: string
  /** Conversational name: the display name up to " & " ("Summit Roofing"). */
  casualName: string
  /** Wordmark ("Summit") — "call Summit", "a Summit team member". */
  shortName: string
  /** Company phone, dashed ("704-313-8834"). */
  phone: string
  email: string
  website: string
  /** Office address, one entry per line. */
  addressLines: string[]
  /** Office address on one line ("Street, City, ST ZIP"). */
  addressLine: string
}

/** Pure: the letterhead spellings for a resolved brand. Plain data, safe to pass to client components. */
export function brandDocument(brand: OrgBrand): DocumentBrand {
  const legalName = brand.documentLegalName || brand.legalName
  const address = brand.documentAddress || brand.address
  const addressLines = address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return {
    name: brand.name,
    nameUpper: brand.name.toUpperCase(),
    legalName,
    legalNameUpper: legalName.toUpperCase(),
    casualName: brand.name.split(' & ')[0].trim() || brand.name,
    shortName: brand.shortName,
    phone: formatPhoneDashed(brand.phone),
    email: brand.email,
    website: brand.website,
    addressLines,
    addressLine: addressLines.join(', '),
  }
}

/** Load an org's brand and its letterhead spellings in one call (server only). */
export async function getDocumentBrand(client: SupabaseClient, orgId: string | null | undefined): Promise<DocumentBrand> {
  return brandDocument(await getOrgBrand(client, orgId))
}

/** Letterhead spellings for an org with no stored identity (the fallback at module load; dev harness only). */
export const DEFAULT_DOCUMENT_BRAND: Readonly<DocumentBrand> = Object.freeze(brandDocument(resolveOrgBrand(null)))
