/**
 * What a customer's signing request must look like — checked on the server, whatever the page sent.
 * The signing pages validate the same things for the customer's benefit; this is the check that counts.
 */

/** A drawn signature is a small PNG data URL (the pad's output). Anything else would bloat the row or break the PDF. */
export const MAX_SIGNATURE_CHARS = 400_000
export const MAX_PRINT_NAME_CHARS = 200
export const MAX_INITIALS_CHARS = 8
const PNG_DATA_URL = /^data:image\/png;base64,(iVBORw0KGgo[A-Za-z0-9+/]*={0,2})$/

export function cleanSignatureImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_SIGNATURE_CHARS) return null
  return PNG_DATA_URL.test(value) ? value : null
}

export function cleanPrintName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= MAX_PRINT_NAME_CHARS ? name : null
}

export function cleanInitials(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const initials = value.trim()
  return initials.length > 0 && initials.length <= MAX_INITIALS_CHARS ? initials : null
}

/** 'phone' | 'email' | null (not given). `false` means a value was given that the column would refuse. */
export function cleanPreferredContact(value: unknown): 'phone' | 'email' | null | false {
  if (value == null || value === '') return null
  return value === 'phone' || value === 'email' ? value : false
}

export type ContractInitials = {
  changeOrders: string | null
  propertyCondition: string | null
  landscaping: string | null
  insurance: string | null
}

/**
 * The initials this agreement requires, by type and payment method — the same rule the signing page applies.
 * Returns the message to show, or null when everything required is there.
 */
export function contractInitialsProblem(
  contract: { agreement_type?: string | null; payment_method?: string | null },
  initials: ContractInitials
): string | null {
  const type = contract.agreement_type || 'installation'
  const insurance = contract.payment_method === 'insurance'
  if (type === 'contingency') {
    return initials.insurance ? null : 'Please initial the insurance contingency acknowledgement'
  }
  if (type === 'repair') {
    if (!initials.changeOrders) return 'Please add your initials'
    if (insurance && !initials.insurance) return 'Please initial the insurance acknowledgement section'
    return null
  }
  if (!initials.changeOrders || !initials.propertyCondition || !initials.landscaping) {
    return 'Please initial all acknowledgement sections'
  }
  if (insurance && !initials.insurance) return 'Please initial the insurance acknowledgement section'
  return null
}

/** Who signed, as far as the request says: first address of x-forwarded-for (the platform's own), else x-real-ip. */
export function signingEvidence(headers: { get(name: string): string | null }): { ip: string; userAgent: string | null } {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown'
  const ua = headers.get('user-agent')?.trim()
  return { ip, userAgent: ua ? ua.slice(0, 500) : null }
}
