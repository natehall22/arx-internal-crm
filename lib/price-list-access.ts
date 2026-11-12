/** Who may make a price list: ONE role check for the API and for the button that offers it (client-safe). */
export const PRICE_LIST_EDIT_ROLES: readonly string[] = ['admin', 'operations']

export function canEditPriceLists(role: string | null | undefined): boolean {
  return !!role && PRICE_LIST_EDIT_ROLES.includes(role)
}

export const PRICE_LIST_NAME_MAX = 120

/** A price list name from a request: trimmed, 1–120 characters, or why not. */
export function cleanPriceListName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) return { ok: false, error: 'Give the price list a name' }
  if (name.length > PRICE_LIST_NAME_MAX) return { ok: false, error: `The name can be up to ${PRICE_LIST_NAME_MAX} characters` }
  return { ok: true, name }
}
