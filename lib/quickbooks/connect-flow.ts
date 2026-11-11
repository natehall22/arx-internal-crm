/** Names shared by the three QuickBooks connect routes (start in Settings, callback at Intuit's one redirect, finish). */
export const QB_CONNECT_COOKIE = 'qb_connect_nonce'
export const QB_CONNECT_COOKIE_PATH = '/api/integrations/quickbooks'
/** Back to the Settings card with a plain-words outcome (`?quickbooks=<code>`). */
export const QB_RETURN_PATH = '/admin'
export type QbOutcome = 'connected' | 'denied' | 'invalid_state' | 'owner_only' | 'intuit_refused' | 'different_company' | 'realm_in_use' | 'use_company_address' | 'failed' | 'off'

export function qbReturn(outcome: QbOutcome): string {
  return `${QB_RETURN_PATH}?quickbooks=${outcome}#quickbooks`
}

/** What the callback parks on the ticket: Intuit's one-time code and the company (realm) it was granted for. */
export function packCallback(code: string, realmId: string): string {
  return JSON.stringify({ c: code, r: realmId })
}

export function unpackCallback(parked: string): { code: string; realmId: string } | null {
  try {
    const v = JSON.parse(parked) as { c?: unknown; r?: unknown }
    if (typeof v.c !== 'string' || !v.c || typeof v.r !== 'string' || !/^\d{4,20}$/.test(v.r)) return null
    return { code: v.c, realmId: v.r }
  } catch {
    return null
  }
}
