/**
 * Company identity (name, phone, website, service area…) — the ONE reader.
 *
 * Precedence per field: name/phone/email/address come from their `orgs` column; shortName/website/serviceArea
 * (no column) from `orgs.settings.brand`; either way a missing value → DEFAULT_ORG_BRAND. Blank /
 * whitespace-only strings count as missing.
 *
 * DEFAULT_ORG_BRAND holds the exact strings the CRM printed before identity moved onto the org row, so an
 * org with empty settings renders byte-identical output. They are the original company's values and stay in
 * this .ts file on purpose (the hardcode ratchet counts them). A second company must set its org row /
 * `settings.brand` (Admin → Settings → General) or it shows these. Do not add another copy of these strings
 * anywhere — read them through this module.
 *
 * Customer documents show the owning rep's phone when it is dialable, else the company phone (`contactPhone`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { ARX_DEFAULT_OFFICE_ADDRESS } from '@/lib/company-address'
import { formatPhone, telHref } from '@/lib/format'

export interface OrgBrand {
  /** Display name, e.g. report footers and email headers. */
  name: string
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
}

export const DEFAULT_ORG_BRAND: Readonly<OrgBrand> = Object.freeze({
  name: 'ARX Roofing & Exteriors',
  shortName: 'ARX',
  phone: '(704) 313-8834',
  email: 'info@arxroofing.com',
  website: 'arxroofing.com',
  serviceArea: 'Charlotte / Kannapolis, NC',
  address: ARX_DEFAULT_OFFICE_ADDRESS,
})

const ORG_BRAND_KEYS = Object.keys(DEFAULT_ORG_BRAND) as Array<keyof OrgBrand>

/** Fields that are real `orgs` columns (edited as Company Name / Phone / Email / Address). The column always wins. */
const COLUMN_BACKED = ['name', 'phone', 'email', 'address'] as const
type ColumnBackedKey = (typeof COLUMN_BACKED)[number]

/** The only keys stored under `orgs.settings.brand` — fields with no `orgs` column. */
export const BRAND_SETTINGS_KEYS = ['shortName', 'website', 'serviceArea'] as const
export type BrandSettingsKey = (typeof BRAND_SETTINGS_KEYS)[number]

/** Longest value a brand field may hold (characters, after trimming). */
export const BRAND_FIELD_MAX = 120

function isColumnBacked(key: keyof OrgBrand): key is ColumnBackedKey {
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

/** Pure: resolve every identity field for an org row (null row → defaults). */
export function resolveOrgBrand(row: OrgBrandRow | null | undefined): OrgBrand {
  const stored = brandObject(row?.brand ?? row?.settings?.brand)
  const out = {} as OrgBrand
  for (const key of ORG_BRAND_KEYS) {
    // column-backed fields never read settings.brand (a stale copy there must not override the column)
    const value = isColumnBacked(key) ? present(row?.[key]) : present(stored[key])
    out[key] = value ?? DEFAULT_ORG_BRAND[key]
  }
  return out
}

/** Load and resolve an org's brand. Falls back to defaults (with a warning) if the row can't be read. */
export async function getOrgBrand(client: SupabaseClient, orgId: string | null | undefined): Promise<OrgBrand> {
  if (!orgId) return resolveOrgBrand(null)
  const { data, error } = await client
    .from('orgs')
    .select('name, phone, email, address, brand:settings->brand')
    .eq('id', orgId)
    .maybeSingle()
  if (error || !data) {
    console.warn('getOrgBrand: org row not readable, using defaults', orgId, error?.message)
    return resolveOrgBrand(null)
  }
  return resolveOrgBrand(data as OrgBrandRow)
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

/** Pure: whole new `orgs.settings` with a brand patch applied; every other settings key is kept. */
export function brandSettingsUpdate(currentSettings: unknown, patch: BrandPatch): Record<string, unknown> {
  const current = brandObject(currentSettings)
  return { ...current, brand: mergeBrandSettings(current.brand, patch) }
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /merge_org_brand_settings/.test(error.message ?? '')
}

/**
 * Write a brand patch into `orgs.settings.brand`, touching only the patched keys. Uses the atomic SQL merge
 * `merge_org_brand_settings` (migration 202611050010) so a concurrent save of another settings key is never
 * overwritten. Until that migration is applied it falls back to read → merge → write of `settings`.
 */
export async function saveBrandSettings(
  client: SupabaseClient,
  orgId: string,
  patch: BrandPatch
): Promise<{ error: string | null }> {
  const { set, remove } = brandPatchOps(patch)
  if (!Object.keys(set).length && !remove.length) return { error: null }

  const { error } = await client.rpc('merge_org_brand_settings', { p_org_id: orgId, p_set: set, p_remove: remove })
  if (!error) return { error: null }
  if (!isMissingFunction(error)) return { error: error.message }

  const { data, error: readError } = await client.from('orgs').select('settings').eq('id', orgId).single()
  if (readError || !data) return { error: readError?.message ?? 'Organization not found' }
  const { error: writeError } = await client
    .from('orgs')
    .update({ settings: brandSettingsUpdate(data.settings, patch) })
    .eq('id', orgId)
  return { error: writeError?.message ?? null }
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

/** Absolute URL for the website field (stored with or without a protocol). */
export function brandWebsiteHref(brand: Pick<OrgBrand, 'website'>): string {
  return /^https?:\/\//i.test(brand.website) ? brand.website : `https://${brand.website}`
}
