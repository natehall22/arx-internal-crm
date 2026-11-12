/**
 * The ONE accounting-API client (fetch only). The worker talks to QuickBooks through the `QbClient` interface; tests pass a
 * fake. This file is the real one: auth header, `minorversion`, `requestid`, timeouts, one refresh-and-retry on 401, a few
 * short in-call back-offs on 429, and Fault parsing (faults.ts). It never logs a token.
 *
 * Intuit facts used here (cited in docs/quickbooks-sync.md):
 *  - writes carry `?requestid=` (<= 50 characters, unique per company; a repeated id returns the first response instead of
 *    running again) and `?minorversion=75`; the id is a 32-hex hash, never our long outbox key;
 *  - ~500 requests/minute and ~10 per second per company -> we pace at one call per 120 ms and never run a company's calls in parallel;
 *  - queries: `GET /query?query=select * from X where ...`, at most 1000 rows a page (STARTPOSITION / MAXRESULTS).
 */
import { QB_MINOR_VERSION, quickBooksApiBase, type QbEnvironment } from './config'
import { classifyFailure, readFault, type QbCallError, type QbResult } from './faults'

export type QbEntity = 'Customer' | 'Invoice' | 'Payment' | 'RefundReceipt' | 'Vendor' | 'Bill' | 'VendorCredit' | 'Item' | 'Account' | 'TaxCode' | 'TaxRate' | 'Class' | 'Preferences' | 'CompanyInfo'
export type QbObject = Record<string, any> & { Id?: string; SyncToken?: string }

export interface QbClient {
  readonly realmId: string
  /** `where` is the QuickBooks query condition without the word WHERE (use `qbQuote` for values). One call returns up to `max` rows (<= 1000). */
  query<T = QbObject>(entity: QbEntity, where?: string | null, opts?: { max?: number; start?: number; orderBy?: string }): Promise<QbResult<T[]>>
  read<T = QbObject>(entity: QbEntity, id: string): Promise<QbResult<T>>
  create<T = QbObject>(entity: QbEntity, body: Record<string, unknown>, requestId: string): Promise<QbResult<T>>
  /** `body` must carry Id and the CURRENT SyncToken (`sparse: true` updates only the fields given). */
  update<T = QbObject>(entity: QbEntity, body: Record<string, unknown>, requestId: string): Promise<QbResult<T>>
  /** Void keeps the record (amounts zeroed); nothing is ever deleted. Invoice and Payment only. */
  void<T = QbObject>(entity: 'Invoice' | 'Payment', ref: { Id: string; SyncToken: string }, requestId: string): Promise<QbResult<T>>
}

/** A value inside a QuickBooks query string: single-quoted, with ' and \ escaped. */
export function qbQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export type QbSession = {
  /** The access token; `force` = the last one was refused (401), get a fresh one. null = no token available. */
  token(force?: boolean): Promise<string | null>
}

export type QbClientOptions = {
  environment: QbEnvironment
  realmId: string
  session: QbSession
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Minimum gap between calls (default 120 ms = under 10 calls a second). */
  minGapMs?: number
  now?: () => number
}

const MAX_THROTTLE_RETRIES = 2

export function createQbClient(opts: QbClientOptions): QbClient {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const gap = opts.minGapMs ?? 120
  const base = `${quickBooksApiBase(opts.environment)}/v3/company/${encodeURIComponent(opts.realmId)}`
  let lastCall = 0

  async function once(method: 'GET' | 'POST', path: string, params: Record<string, string>, body: unknown, token: string): Promise<{ status: number; json: unknown; headers: Headers | null }> {
    const wait = lastCall + gap - now()
    if (wait > 0) await sleep(wait)
    lastCall = now()
    const url = new URL(`${base}${path}`)
    for (const [k, v] of Object.entries({ ...params, minorversion: String(QB_MINOR_VERSION) })) url.searchParams.set(k, v)
    try {
      const res = await doFetch(url.toString(), {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      return { status: res.status, json, headers: res.headers ?? null }
    } catch {
      return { status: 0, json: {}, headers: null }
    }
  }

  async function send<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>, body: unknown, pick: (json: any) => T | undefined): Promise<QbResult<T>> {
    let token = await opts.session.token()
    if (!token) return { ok: false, kind: 'auth', status: 401, code: null, message: 'No QuickBooks login available', detail: null, retryAfterSec: null, intuitTid: null }
    let refreshed = false
    for (let attempt = 0; ; attempt++) {
      const r = await once(method, path, params, body, token)
      const intuitTid = r.headers?.get('intuit_tid') ?? null
      const faulted = readFault(r.json) !== null
      if (r.status >= 200 && r.status < 300 && !faulted) {
        const value = pick(r.json)
        if (value !== undefined) return { ok: true, value, intuitTid }
        // 2xx with a body we cannot read: nobody knows what happened -> same as no answer (the caller looks it up).
        return { ...classifyFailure(0, {}, undefined), message: 'QuickBooks sent an answer we could not read' }
      }
      const err: QbCallError = classifyFailure(r.status >= 200 && r.status < 300 ? 400 : r.status, r.json, r.headers ?? undefined)
      if (err.kind === 'auth' && !refreshed) {
        refreshed = true
        const fresh = await opts.session.token(true)
        if (!fresh) return err
        token = fresh
        continue
      }
      if (err.kind === 'throttled' && attempt < MAX_THROTTLE_RETRIES) {
        await sleep(Math.min((err.retryAfterSec ?? 2 ** attempt) * 1000, 5000))
        continue
      }
      return err
    }
  }

  const seg = (e: QbEntity) => e.toLowerCase()

  return {
    realmId: opts.realmId,
    async query<T>(entity: QbEntity, where?: string | null, o: { max?: number; start?: number; orderBy?: string } = {}) {
      const max = Math.min(Math.max(o.max ?? 1000, 1), 1000)
      const sql = `select * from ${entity}${where ? ` where ${where}` : ''}${o.orderBy ? ` orderby ${o.orderBy}` : ''} startposition ${o.start ?? 1} maxresults ${max}`
      return send<T[]>('GET', '/query', { query: sql }, undefined, (j) => {
        const rows = j?.QueryResponse?.[entity]
        return Array.isArray(rows) ? (rows as T[]) : j?.QueryResponse ? [] : undefined
      })
    },
    read<T>(entity: QbEntity, id: string) {
      return send<T>('GET', `/${seg(entity)}/${encodeURIComponent(id)}`, {}, undefined, (j) => j?.[entity] as T | undefined)
    },
    create<T>(entity: QbEntity, body: Record<string, unknown>, requestId: string) {
      return send<T>('POST', `/${seg(entity)}`, { requestid: requestId }, body, (j) => j?.[entity] as T | undefined)
    },
    update<T>(entity: QbEntity, body: Record<string, unknown>, requestId: string) {
      return send<T>('POST', `/${seg(entity)}`, { requestid: requestId }, body, (j) => j?.[entity] as T | undefined)
    },
    void<T>(entity: 'Invoice' | 'Payment', ref: { Id: string; SyncToken: string }, requestId: string) {
      return send<T>('POST', `/${seg(entity)}`, { operation: 'void', requestid: requestId }, { Id: ref.Id, SyncToken: ref.SyncToken }, (j) => j?.[entity] as T | undefined)
    },
  }
}
