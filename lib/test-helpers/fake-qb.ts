/**
 * An in-memory QuickBooks company for tests: one `FakeQbCompany` per realm. It behaves the way the Intuit API is documented to:
 *  - `requestid` replays the FIRST response of a repeated id instead of running the write again;
 *  - an update needs the CURRENT SyncToken (else fault 5010 "Stale Object"); every write bumps it;
 *  - names of Customer / Vendor must be unique across both lists (fault 6240);
 *  - a void zeroes an invoice and prefixes "Voided" to PrivateNote; invoice Balance = total - payments linked to it;
 *  - tax: `taxPercent` models Automated Sales Tax (tax computed on lines coded TAX, the CRM's tax is ignored), otherwise
 *    TxnTaxDetail.TotalTax is taken as sent.
 * Failures are injected with `failNext`; `afterCommit: true` = the write LANDED but the answer was lost (timeout), the case find-before-send exists for.
 */
import type { QbClient, QbEntity, QbObject } from '@/lib/quickbooks/client'
import { classifyFailure, type QbCallError, type QbResult } from '@/lib/quickbooks/faults'

export type FakeCall = { op: 'query' | 'read' | 'create' | 'update' | 'void'; entity: string; requestId?: string; body?: Record<string, any>; where?: string | null }

export function fault(status: number, code: string, message: string, detail?: string): QbCallError {
  return classifyFailure(status, { Fault: { Error: [{ Message: message, Detail: detail ?? message, code }], type: 'ValidationFault' } })
}

export class FakeQbCompany {
  readonly store: Record<string, QbObject[]> = {}
  readonly calls: FakeCall[] = []
  readonly seen = new Map<string, QbResult<QbObject>>()
  private nextId = 100
  taxPercent = 0
  private failures: Array<{ op?: FakeCall['op']; entity?: string; err: QbCallError; afterCommit: boolean; times: number }> = []
  /** When set, every call answers with this (a dead login, a throttle). */
  alwaysFail: QbCallError | null = null

  constructor(readonly realmId: string) {}

  all(entity: string): QbObject[] {
    return (this.store[entity] ??= [])
  }
  failNext(err: QbCallError, opts: { op?: FakeCall['op']; entity?: string; afterCommit?: boolean; times?: number } = {}) {
    this.failures.push({ op: opts.op, entity: opts.entity, err, afterCommit: opts.afterCommit === true, times: opts.times ?? 1 })
  }
  private takeFailure(op: FakeCall['op'], entity: string) {
    const i = this.failures.findIndex((f) => (!f.op || f.op === op) && (!f.entity || f.entity === entity))
    if (i < 0) return null
    const f = this.failures[i]
    if (--f.times <= 0) this.failures.splice(i, 1)
    return f
  }

  private total(entity: string, o: QbObject): number {
    const lines = (o.Line ?? []) as Array<Record<string, any>>
    const sum = lines.reduce((t, l) => t + Math.round(Number(l.Amount) * 100), 0)
    if (entity !== 'Invoice') return sum
    const detail = o.TxnTaxDetail
    if (this.taxPercent > 0) {
      const taxable = lines.filter((l) => l.SalesItemLineDetail?.TaxCodeRef?.value === 'TAX').reduce((t, l) => t + Math.round(Number(l.Amount) * 100), 0)
      return sum + Math.round((taxable * this.taxPercent) / 100)
    }
    return sum + (detail?.TotalTax != null ? Math.round(Number(detail.TotalTax) * 100) : 0)
  }

  private recompute(entity: string, o: QbObject) {
    if (entity === 'Invoice') {
      const total = this.total('Invoice', o)
      o.TotalAmt = total / 100
      const paid = this.all('Payment').reduce((t, p) => t + ((p.Line ?? []) as any[]).filter((l) => l.LinkedTxn?.some((x: any) => x.TxnId === o.Id)).reduce((a, l) => a + Math.round(Number(l.Amount) * 100), 0), 0)
      o.Balance = (total - paid) / 100
    } else if (entity === 'Payment' || entity === 'RefundReceipt' || entity === 'Bill' || entity === 'VendorCredit') {
      o.TotalAmt = entity === 'Payment' ? Number(o.TotalAmt) : this.total(entity, o) / 100
    }
  }

  private nameTaken(entity: string, name: string): boolean {
    if (entity !== 'Customer' && entity !== 'Vendor') return false
    return [...this.all('Customer'), ...this.all('Vendor')].some((o) => String(o.DisplayName).toLowerCase() === name.toLowerCase())
  }

  client(): QbClient {
    const self = this
    const guard = <T>(op: FakeCall['op'], entity: string, run: () => QbResult<T>): QbResult<T> => {
      if (self.alwaysFail) return self.alwaysFail
      const f = self.takeFailure(op, entity)
      if (f && !f.afterCommit) return f.err
      const r = run()
      return f ? f.err : r
    }
    return {
      realmId: self.realmId,
      async query<T>(entity: QbEntity, where?: string | null) {
        self.calls.push({ op: 'query', entity, where })
        return guard<T[]>('query', entity, () => {
          const m = where ? where.match(/^(\w+) = '((?:[^'\\]|\\.)*)'$/) : null
          const rows = self.all(entity).filter((o) => {
            if (!m) return true
            const [, field, raw] = m
            const val = raw.replace(/\\(['\\])/g, '$1')
            return field.endsWith('Ref') ? String(o[field]?.value) === val : String(o[field]) === val
          })
          return { ok: true, value: rows.map((o) => structuredClone(o)) as T[], intuitTid: null }
        })
      },
      async read<T>(entity: QbEntity, id: string) {
        self.calls.push({ op: 'read', entity })
        return guard<T>('read', entity, () => {
          const o = self.all(entity).find((x) => x.Id === id)
          return o ? { ok: true, value: structuredClone(o) as T, intuitTid: null } : fault(400, '610', 'Object Not Found', `Object ${id} not found`)
        })
      },
      async create<T>(entity: QbEntity, body: Record<string, unknown>, requestId: string) {
        self.calls.push({ op: 'create', entity, requestId, body: structuredClone(body) })
        const replay = self.seen.get(requestId)
        if (replay) return replay as QbResult<T>
        return guard<T>('create', entity, () => {
          if (self.nameTaken(entity, String(body.DisplayName ?? ''))) return fault(400, '6240', 'Duplicate Name Exists Error', `The name supplied already exists. : Id=${self.nextId}`)
          const dup = body.DocNumber && ['Invoice', 'Bill'].includes(entity) && self.all(entity).some((o) => o.DocNumber === body.DocNumber && entity === 'Invoice')
          if (dup) return fault(400, '6210', 'Duplicate Document Number Error', 'Duplicate document number')
          const o: QbObject = { ...structuredClone(body), Id: String(self.nextId++), SyncToken: '0' }
          self.all(entity).push(o)
          self.recompute(entity, o)
          if (entity === 'Payment') for (const l of (o.Line ?? []) as any[]) for (const x of l.LinkedTxn ?? []) { const inv = self.all('Invoice').find((i) => i.Id === x.TxnId); if (inv) self.recompute('Invoice', inv) }
          const res: QbResult<QbObject> = { ok: true, value: structuredClone(o), intuitTid: null }
          self.seen.set(requestId, res)
          return res as QbResult<T>
        })
      },
      async update<T>(entity: QbEntity, body: Record<string, unknown>, requestId: string) {
        self.calls.push({ op: 'update', entity, requestId, body: structuredClone(body) })
        const replay = self.seen.get(requestId)
        if (replay) return replay as QbResult<T>
        return guard<T>('update', entity, () => {
          const o = self.all(entity).find((x) => x.Id === body.Id)
          if (!o) return fault(400, '610', 'Object Not Found')
          if (o.SyncToken !== body.SyncToken) return fault(400, '5010', 'Stale Object Error', 'Stale Object Error : You and Another user were trying to modify the same object')
          Object.assign(o, structuredClone(body))
          o.SyncToken = String(Number(o.SyncToken) + 1)
          delete (o as Record<string, unknown>).sparse
          self.recompute(entity, o)
          const res: QbResult<QbObject> = { ok: true, value: structuredClone(o), intuitTid: null }
          self.seen.set(requestId, res)
          return res as QbResult<T>
        })
      },
      async void<T>(entity: 'Invoice' | 'Payment', ref: { Id: string; SyncToken: string }, requestId: string) {
        self.calls.push({ op: 'void', entity, requestId })
        return guard<T>('void', entity, () => {
          const o = self.all(entity).find((x) => x.Id === ref.Id)
          if (!o) return fault(400, '610', 'Object Not Found')
          if (o.SyncToken !== ref.SyncToken) return fault(400, '5010', 'Stale Object Error')
          o.SyncToken = String(Number(o.SyncToken) + 1)
          o.TotalAmt = 0
          o.Balance = 0
          o.PrivateNote = `Voided ${o.PrivateNote ?? ''}`.trim()
          return { ok: true, value: structuredClone(o) as T, intuitTid: null }
        })
      },
    }
  }

  /** Edit a record "in QuickBooks" the way a bookkeeper would (bumps SyncToken). */
  editInQb(entity: string, id: string, patch: Record<string, unknown>) {
    const o = this.all(entity).find((x) => x.Id === id)!
    Object.assign(o, patch)
    o.SyncToken = String(Number(o.SyncToken) + 1)
    this.recompute(entity, o)
  }
}
