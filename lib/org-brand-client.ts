/**
 * The company's names for client components (contract screen, subs text, schedule board) — client-safe, no imports.
 * The server resolves them once (`brandDocument` in lib/org-brand.ts, the ONE reader) and sends them in
 * `/api/me/effective-permissions` `flags.brand`; hooks/useOrgFeatures.ts exposes them as `useOrgBrandNames`.
 * Nothing resolved yet → the generic words, never another company's name.
 */
export type ClientBrandNames = {
  /** "Company Name" — signature blocks. */
  name: string
  /** Legal entity as contracts print it. */
  legalName: string
  /** Wordmark — "authorizes Summit", "share your calendar with Summit". */
  shortName: string
}

export const GENERIC_BRAND_NAMES: Readonly<ClientBrandNames> = Object.freeze({
  name: 'the company',
  legalName: 'the company',
  shortName: 'the company',
})

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Pure: names that came over the wire (or are missing) → a full set; a blank field falls back to the next-best name. */
export function coerceClientBrandNames(v: unknown): ClientBrandNames {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const name = str(o.name)
  if (!name) return { ...GENERIC_BRAND_NAMES }
  return { name, legalName: str(o.legalName) || name, shortName: str(o.shortName) || name }
}

/** Pure: the three names out of a resolved DocumentBrand (server side). */
export function clientBrandNames(b: { name: string; legalName: string; shortName: string }): ClientBrandNames {
  return coerceClientBrandNames(b)
}
