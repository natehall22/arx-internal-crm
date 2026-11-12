/**
 * The consumer e-sign consent step (ESIGN Act 15 U.S.C. 7001(c) / UETA): before a customer signs, they are shown a disclosure
 * and must affirmatively agree; the version they agreed to is stored with the signature. Pure, client-safe.
 *
 * PRE-LAUNCH (not blocking the prototype): the WORDING below is a first draft, not reviewed by counsel. Counsel changes the
 * text here and bumps ESIGN_CONSENT_VERSION; every stored signature keeps the version it was shown, so old signatures still
 * point at the exact words their signer saw (`ESIGN_CONSENT_TEXTS` keeps every version ever shipped).
 */
export const ESIGN_CONSENT_VERSION = 'v1-2026-11'

export type ConsentCompany = { name: string; phone?: string | null; email?: string | null }

export type ConsentDisclosure = {
  version: string
  heading: string
  paragraphs: string[]
  checkboxLabel: string
}

function contactLine(c: ConsentCompany): string {
  const bits = [c.phone, c.email].map((v) => String(v ?? '').trim()).filter(Boolean)
  return bits.length ? ` at ${bits.join(' or ')}` : ''
}

/** The words a signer is shown. Covers the ESIGN elements: the right to paper, how to withdraw, and the means to open and keep the record. */
export function esignDisclosure(company: ConsentCompany): ConsentDisclosure {
  const who = company.name.trim() || 'the company'
  return {
    version: ESIGN_CONSENT_VERSION,
    heading: 'Sign electronically',
    paragraphs: [
      `You can sign this document electronically. Your electronic signature has the same effect as signing on paper, and ${who} will keep a record of when and how you signed.`,
      `You have the right to receive this document on paper at no charge. Ask ${who}${contactLine(company)}. You can also withdraw your agreement to electronic records at any time before you sign by closing this page and contacting ${who}; that does not affect anything you have already signed.`,
      'To read and keep the signed document you need a current web browser, an email address, and a program that opens PDF files. You will be able to download your signed copy from this page and, if we have your email, we will send it to you.',
    ],
    checkboxLabel: 'I have read this notice, I can open and keep PDF documents on this device, and I agree to sign electronically.',
  }
}

export type ConsentInput = { accepted?: unknown; version?: unknown } | null | undefined

/**
 * Server-side check: when the company requires the consent step, a signature without an explicit acceptance of the CURRENT
 * version is refused, whatever the page sent. Returns the version to store.
 */
export function consentCheck(required: boolean, input: unknown): { ok: true; version: string | null } | { ok: false; error: string; code: 'consent_required' } {
  if (!required) return { ok: true, version: null }
  const c = (input && typeof input === 'object' ? input : {}) as { accepted?: unknown; version?: unknown }
  if (c.accepted === true && c.version === ESIGN_CONSENT_VERSION) return { ok: true, version: ESIGN_CONSENT_VERSION }
  return {
    ok: false,
    code: 'consent_required',
    error: c.accepted === true
      ? 'The signing notice was updated. Please reload this page and agree to it again.'
      : 'Please agree to sign electronically before you sign.',
  }
}
