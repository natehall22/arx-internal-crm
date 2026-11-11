/** Consent wording (client-safe: the portal checkbox shows it, the server stores it). */

/** Bump when the wording below changes: every consent row stores the version and the exact text shown. */
export const SMS_CONSENT_WORDING_VERSION = 'v1-2026-11'
/** The sentence a customer agrees to (checkbox label on a form, or read out by staff). */
export function consentText(companyName: string): string {
  const who = companyName.trim() || 'this company'
  return `I agree to get text messages from ${who} about my service: reminders, arrival notices and replies to my questions. Message frequency varies. Message and data rates may apply. Reply STOP to cancel or HELP for help. Agreeing is not required to buy anything.`
}

