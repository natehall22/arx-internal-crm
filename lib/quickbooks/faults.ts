/**
 * What an Intuit answer MEANS to the worker. One classifier for every accounting call (docs/quickbooks-sync.md "Intuit facts").
 *
 *  - Intuit reports errors as HTTP 4xx/5xx with a `Fault` body ({ Fault: { Error: [{ Message, Detail, code, element }], type } }); a
 *    Fault can also arrive inside an HTTP 200, so the body is always checked.
 *  - 429 (code 003001, ThrottleExceeded) = back off; 5xx / timeout / no answer = we do not know whether the write landed
 *    ('transient') — the caller MUST look the record up before sending it again.
 *  - Codes (Intuit "Top QuickBooks Online API errors" post): 5010 stale object (re-read SyncToken), 6240 duplicate name,
 *    6210 duplicate document number (the same code is used for a closed accounting period — told apart by its message),
 *    610 object not found (inactive/deleted reference), 2500 invalid reference, 120 authorization failure (the connecting
 *    admin lost access: stop), 6190 invalid company status (trial/subscription ended: stop), 6000/2020 validation.
 *  - 401 = access token missing/expired/invalid: refresh once and retry (client.ts).
 */
export type QbFaultKind =
  | 'auth' // 401: token expired/invalid — refresh and retry once
  | 'company_stopped' // the QuickBooks company/login can no longer be used until a person acts (120, 6190, 403)
  | 'throttled'
  | 'transient' // 5xx, timeout, no answer: the write MAY have landed
  | 'stale' // 5010
  | 'duplicate_name' // 6240
  | 'duplicate_number' // 6210 (document number already used)
  | 'period_closed' // 6210 with a closed-period message
  | 'not_found' // 610 / 4000: the record or a reference to it is gone or inactive
  | 'inactive_ref' // 2500 / 3100: an account, item, tax code or class we point at is inactive or invalid
  | 'validation' // any other 4xx the request itself caused
  | 'unknown'

export type QbCallError = {
  ok: false
  kind: QbFaultKind
  status: number
  code: string | null
  message: string
  detail: string | null
  retryAfterSec: number | null
  intuitTid: string | null
}
export type QbCallOk<T> = { ok: true; value: T; intuitTid: string | null }
export type QbResult<T> = QbCallOk<T> | QbCallError

type FaultBody = { Fault?: { Error?: Array<{ Message?: unknown; Detail?: unknown; code?: unknown; element?: unknown }>; type?: unknown } }

/** The first error of a Fault body, or null when the body carries none. */
export function readFault(body: unknown): { code: string | null; message: string; detail: string | null; type: string | null } | null {
  const fault = (body as FaultBody | null)?.Fault
  if (!fault) return null
  const first = Array.isArray(fault.Error) ? fault.Error[0] : undefined
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null)
  return {
    code: first?.code != null ? String(first.code) : null,
    message: s(first?.Message) ?? 'QuickBooks refused the request',
    detail: s(first?.Detail),
    type: s(fault.type),
  }
}

export function classifyFailure(status: number, body: unknown, headers?: { get(name: string): string | null }): QbCallError {
  const fault = readFault(body)
  const code = fault?.code ?? null
  const text = `${fault?.message ?? ''} ${fault?.detail ?? ''}`
  const retryAfter = Number(headers?.get('retry-after'))
  const base = {
    ok: false as const,
    status,
    code,
    message: fault?.message ?? `QuickBooks answered ${status}`,
    detail: fault?.detail ?? null,
    retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 300) : null,
    intuitTid: headers?.get('intuit_tid') ?? null,
  }
  const kind = ((): QbFaultKind => {
    if (status === 429 || code === '003001' || /ThrottleExceeded/i.test(text)) return 'throttled'
    if (status === 401) return code === '120' ? 'company_stopped' : 'auth'
    if (status === 403) return 'company_stopped'
    if (status >= 500 || status === 0) return 'transient'
    if (code === '120' || code === '6190') return 'company_stopped'
    if (code === '5010' || /stale object/i.test(text)) return 'stale'
    if (code === '6240' || /duplicate name/i.test(text)) return 'duplicate_name'
    if (code === '6210') return /period|closed|books/i.test(text) ? 'period_closed' : 'duplicate_number'
    if (/duplicate document number/i.test(text)) return 'duplicate_number'
    if (code === '610' || code === '4000' || /object not found/i.test(text)) return 'not_found'
    if (code === '2500' || code === '3100' || /invalid reference/i.test(text)) return 'inactive_ref'
    if (status >= 400) return 'validation'
    return 'unknown'
  })()
  return { ...base, kind }
}

/** Plain words for the owner. Never an Intuit code on its own; the code goes in small print next to this. */
export function plainReason(e: Pick<QbCallError, 'kind' | 'message' | 'detail'>): string {
  switch (e.kind) {
    case 'auth':
    case 'company_stopped':
      return 'QuickBooks stopped accepting the CRM’s login. Reconnect QuickBooks in Settings, then press Retry.'
    case 'throttled':
      return 'QuickBooks asked us to slow down. This will be tried again shortly.'
    case 'transient':
      return 'QuickBooks did not answer. This will be tried again shortly.'
    case 'stale':
      return 'Someone changed this record in QuickBooks at the same moment. It will be checked again.'
    case 'duplicate_name':
      return 'QuickBooks already has a customer, vendor or employee with this exact name that is not the same person. Rename one of them in QuickBooks, then press Retry.'
    case 'duplicate_number':
      return 'QuickBooks already has a different document with this number. Change or remove that one in QuickBooks, then press Retry.'
    case 'period_closed':
      return 'Your QuickBooks books are closed for this date, so QuickBooks refused it. Ask your bookkeeper to reopen the period or enter it by hand, then press Retry or Skip.'
    case 'not_found':
    case 'inactive_ref':
      return `Something this needs in QuickBooks is inactive or was deleted (${(e.detail ?? e.message).slice(0, 160)}). Fix it in QuickBooks or in the QuickBooks mapping, then press Retry.`
    case 'validation':
      return `QuickBooks refused this: ${(e.detail ?? e.message).slice(0, 200)}`
    default:
      return 'QuickBooks gave an answer we did not expect. Press Retry; if it happens again, send this line to support.'
  }
}

/** Should the worker try the same event again later without a person? */
export function isRetryable(kind: QbFaultKind): boolean {
  return kind === 'throttled' || kind === 'transient' || kind === 'stale' || kind === 'auth'
}
