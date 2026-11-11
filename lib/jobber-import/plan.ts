/**
 * Move from Jobber — the Check step. Pure and client-safe: Jobber files + the owner's column choices + what is already in
 * the CRM → the list of things the import will do (items) and what a person needs to see first (counts, duplicates,
 * problems per row). Nothing here writes; lib/jobber-import/db.ts stores the items and the Import step carries them out.
 *
 * Two passes, because "same address" is decided by ONE SQL rule (property_address_key): `readJobberFiles` reads every
 * file into plain records; the caller asks SQL for the keys of `addressesOf(...)` in one call; `buildPlan` matches.
 */
import { CUSTOM_FIELD_LIMITS, cleanFieldValue, type CustomFieldDefinition, type CustomFieldEntity } from '@/lib/custom-fields'
import { matchExistingCustomer, type CustomerIdentityRow } from '@/lib/customers'
import { formatPropertyAddress } from '@/lib/properties'
import type { BillingBasis, Season } from '@/lib/service-plans'

import { JOBBER_FILE_KIND_LABELS, mapRow, resolveMapping, type JobberFileKind } from './columns'
import { inferSchedule } from './schedule'
import {
  detectDateOrder,
  isEmail,
  moneyCents,
  nameKey,
  numberValue,
  parseDate,
  parseLineItems,
  phoneDigits,
  splitJid,
  splitMulti,
  stateCode,
  yesNo,
  type DateOrder,
  type LineItem,
} from './values'

// ---------------------------------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------------------------------

export type RunFile = { id: string; name: string; kind: JobberFileKind; headers: string[]; rows: string[][] }

export type ImportOptions = {
  /** Owner's pick when Jobber's dates could be read both ways. null = what the files prove (month/day if nothing does). */
  dateOrder: DateOrder | null
  /** Service type (org trade slug) new plans get. null = the plan items carry a problem until one is picked. */
  trade: string | null
  /** Leave out clients Jobber marks archived (unless an invoice or plan in these files needs them). */
  skipArchived: boolean
  /** Company "today" (YYYY-MM-DD) — plans that ended in Jobber come in ended. */
  today: string
}

export type Problem = { severity: 'error' | 'warning'; file: string; row: number | null; message: string }

export type ItemKind = 'custom_field' | 'price_item' | 'customer' | 'property' | 'plan' | 'invoice' | 'history'
export const ITEM_RANK: Record<ItemKind | 'document', number> = {
  custom_field: 1,
  price_item: 2,
  customer: 3,
  property: 4,
  plan: 5,
  invoice: 6,
  history: 7,
  document: 8,
}
export type ItemAction = 'create' | 'update' | 'link' | 'skip'

export type PlanItem = {
  kind: ItemKind
  rank: number
  seq: number
  source_id: string
  label: string
  action: ItemAction
  /** Existing row this item updates or links to (create = null). */
  target_id: string | null
  payload: Record<string, unknown>
  problems: Problem[]
}

/** A reference to a customer: one this import makes (by its item source id) or one already in the CRM. */
export type CustomerRef = { source_id: string } | { customer_id: string }
export type PropertyRef = { source_id: string } | { property_id: string }

export type ExistingCustomer = CustomerIdentityRow & { import_source_id: string | null }
export type ExistingProperty = { id: string; customer_id: string; address_key: string; import_source_id: string | null }
export type ExistingSnapshot = {
  customers: ExistingCustomer[]
  properties: ExistingProperty[]
  fieldDefs: Array<CustomFieldDefinition & { import_source_id: string | null }>
  priceItems: Array<{ id: string; name: string; import_source_id: string | null }>
  plans: Array<{ id: string; import_source_id: string | null }>
  invoices: Array<{ id: string; invoice_number: string; import_source_id: string | null }>
  /** Active trades (slug + label) for the plan service-type check. */
  trades: Array<{ slug: string; label: string }>
}

// ---------------------------------------------------------------------------------------------------------------------
// Pass 1: read the files
// ---------------------------------------------------------------------------------------------------------------------

type Address = { line1: string | null; line2: string | null; city: string | null; state: string | null; zip: string | null }
const addr = (f: Record<string, string>, p: 'service' | 'billing'): Address => ({
  line1: f[`${p}_street1`] ?? null,
  line2: f[`${p}_street2`] ?? null,
  city: f[`${p}_city`] ?? null,
  state: stateCode(f[`${p}_state`]),
  zip: f[`${p}_zip`] ?? null,
})
const addressText = (a: Address) => formatPropertyAddress({ address_line1: a.line1, address_line2: a.line2, city: a.city, state: a.state, zip: a.zip })

type Where = { file: string; row: number }
type CustomValue = { entity: CustomFieldEntity; label: string; value: string }

export type ClientRecord = {
  sourceId: string
  where: Where
  name: string
  email: string | null
  extraEmails: string[]
  phone: string | null
  extraPhones: string[]
  billing: Address
  archived: boolean
  custom: CustomValue[]
  properties: Array<{ sourceId: string; where: Where; label: string | null; address: Address; custom: CustomValue[] }>
  problems: Problem[]
}

type ReportContact = { name: string | null; email: string | null; phone: string | null; service: Address }

export type QuoteRecord = { where: Where; number: string; who: ReportContact; title: string | null; status: string | null; lines: string | null; totalCents: number | null; dates: Record<string, string | null>; notes: string[] }
export type RecurringRecord = { where: Where; number: string; who: ReportContact; title: string | null; billingType: string | null; lines: LineItem[] | null; linesText: string | null; totalCents: number | null; start: string | null; end: string | null; frequencyText: string | null; notes: string[] }
export type OneOffRecord = { where: Where; number: string; who: ReportContact; title: string | null; lines: string | null; totalCents: number | null; dates: Record<string, string | null>; notes: string[] }
export type InvoiceRecord = {
  where: Where
  number: string
  who: ReportContact
  subject: string | null
  status: string | null
  issued: string | null
  due: string | null
  paidDate: string | null
  created: string | null
  jobNumbers: string | null
  lines: LineItem[] | null
  linesText: string | null
  totalCents: number | null
  balanceCents: number | null
  taxCents: number | null
  taxPercent: number | null
  notes: string[]
}
export type ProductRecord = { where: Where; name: string; description: string | null; priceCents: number | null; costCents: number | null; taxable: boolean; category: string | null; active: boolean }

export type ReadResult = {
  clients: ClientRecord[]
  quotes: QuoteRecord[]
  recurring: RecurringRecord[]
  oneOff: OneOffRecord[]
  invoices: InvoiceRecord[]
  products: ProductRecord[]
  visitDatesByJob: Map<string, string[]>
  problems: Problem[]
  dateOrder: { order: DateOrder; ambiguous: boolean; conflicting: boolean; chosen: boolean }
  files: Array<{ id: string; name: string; kind: JobberFileKind; rows: number }>
}

const DATE_FIELDS = ['created', 'issued', 'due', 'paid_date', 'start', 'end', 'closed', 'date', 'drafted', 'sent', 'approved', 'converted', 'archived_date']

function contact(f: Record<string, string>): ReportContact {
  const emails = splitMulti(f.client_email).filter(isEmail)
  return { name: f.client_name ?? null, email: emails[0]?.toLowerCase() ?? null, phone: splitMulti(f.client_phone)[0] ?? null, service: addr(f, 'service') }
}

/** What one file says about the date order (a day over 12 first = day/month; second = month/day). */
export type DateEvidence = { dmy: boolean; mdy: boolean }

export function fileDateEvidence(file: RunFile, choices: Record<string, unknown> | undefined): DateEvidence {
  const mapping = resolveMapping(file.kind, file.headers, choices ?? {})
  const idx = mapping.map((m, i) => (DATE_FIELDS.includes(m.target) ? i : -1)).filter((i) => i >= 0)
  const cells: string[] = []
  for (const r of file.rows) for (const i of idx) if (r[i]) cells.push(r[i])
  const d = detectDateOrder(cells)
  return { dmy: d.order === 'dmy' || d.conflicting, mdy: (d.order === 'mdy' && !d.ambiguous) || d.conflicting }
}

/** One date order for the whole upload (every file comes out of the same Jobber account); the owner's pick wins. */
export function decideDateOrder(evidence: DateEvidence[], chosen: DateOrder | null): ReadResult['dateOrder'] {
  const dmy = evidence.some((e) => e.dmy)
  const mdy = evidence.some((e) => e.mdy)
  const detected: DateOrder = dmy && !mdy ? 'dmy' : 'mdy'
  return { order: chosen ?? detected, ambiguous: !dmy && !mdy, conflicting: dmy && mdy, chosen: chosen !== null }
}

/** A file read on its own (the Check reads one file per request); JSON-safe, so it can be stored between requests. */
export type ReadPart = Omit<ReadResult, 'visitDatesByJob' | 'dateOrder'> & { visitDatesByJob: Record<string, string[]> }

/** Excel re-saves turn long numbers into "8.50555E+09" and drop a ZIP's leading zero ("2108" for 02108). */
const EXCEL_NUMBER = /^\d(\.\d+)?E\+\d+$/i
function excelDamage(where: Where, label: string, raw: string | undefined, kind: 'phone' | 'zip', problems: Problem[]) {
  if (!raw) return
  if (EXCEL_NUMBER.test(raw.trim())) problems.push({ severity: 'warning', file: where.file, row: where.row, message: `${label} “${raw}” looks changed by Excel (digits lost) — fix it in Jobber’s original export, or after the import` })
  else if (kind === 'zip' && /^\d{3,4}$/.test(raw.trim())) problems.push({ severity: 'warning', file: where.file, row: where.row, message: `${label} “${raw}” lost its leading zero (Excel) — check it` })
}

export function readOneFile(file: RunFile, choices: Record<string, unknown> | undefined, order: DateOrder): ReadPart {
  const problems: Problem[] = []
  const mapping = resolveMapping(file.kind, file.headers, choices ?? {})
  const mapped = [{ file, rows: file.rows.map((r, i) => ({ row: i + 2, m: mapRow(mapping, r) })) }]
  const dateOf = (where: Where, label: string, raw: string | undefined): string | null => {
    if (!raw) return null
    const d = parseDate(raw, order)
    if (!d) problems.push({ severity: 'warning', file: where.file, row: where.row, message: `${label} “${raw}” isn’t a date we can read — left blank` })
    return d
  }
  const moneyOf = (where: Where, label: string, raw: string | undefined): number | null => {
    const c = moneyCents(raw)
    if (c !== null && Number.isNaN(c)) {
      problems.push({ severity: 'warning', file: where.file, row: where.row, message: `${label} “${raw}” isn’t an amount we can read — left blank` })
      return null
    }
    return c
  }

  const clientsById = new Map<string, ClientRecord>()
  const visitDates = new Map<string, string[]>()
  const out = {
    clients: [] as ClientRecord[],
    quotes: [] as QuoteRecord[],
    recurring: [] as RecurringRecord[],
    oneOff: [] as OneOffRecord[],
    invoices: [] as InvoiceRecord[],
    products: [] as ProductRecord[],
    visitDatesByJob: visitDates,
    problems,
    files: [{ id: file.id, name: file.name, kind: file.kind, rows: file.rows.length }],
  }

  for (const { file, rows } of mapped) {
    for (const { row, m } of rows) {
      const f = m.fields
      const where = { file: file.name, row }
      const notes = m.notes
      switch (file.kind) {
        case 'clients': {
          const jid = splitJid(f.jid)
          const clientId = jid.client ?? `row:${file.id}:${row}`
          let c = clientsById.get(clientId)
          if (!c) {
            const isCompany = yesNo(f.is_company) === true
            const person = [f.first_name, f.last_name].filter(Boolean).join(' ') || f.full_name || ''
            const emails = splitMulti(f.emails)
            const goodEmails = emails.filter(isEmail).map((e) => e.toLowerCase())
            const phones = [f.main_phone, f.mobile_phone, f.sms_phone, f.home_phone, f.work_phone, f.other_phone].flatMap((p) => splitMulti(p)).filter((p) => !EXCEL_NUMBER.test(p))
            const uniquePhones: string[] = []
            for (const p of phones) if (!uniquePhones.some((q) => phoneDigits(q) && phoneDigits(q) === phoneDigits(p))) uniquePhones.push(p)
            const name = (f.display_name || (isCompany ? f.company : '') || person || f.company || goodEmails[0] || uniquePhones[0] || '').slice(0, 120)
            c = {
              sourceId: clientId,
              where,
              name,
              email: goodEmails[0] ?? null,
              extraEmails: goodEmails.slice(1),
              phone: uniquePhones[0] ?? null,
              extraPhones: uniquePhones.slice(1),
              billing: addr(f, 'billing'),
              archived: yesNo(f.archived) === true,
              custom: [],
              properties: [],
              problems: [],
            }
            if (!name) c.problems.push({ severity: 'error', file: file.name, row, message: 'No name, company, email or phone — this client can’t be brought over' })
            for (const bad of emails.filter((e) => !isEmail(e))) c.problems.push({ severity: 'warning', file: file.name, row, message: `“${bad}” isn’t an email address — left out` })
            if (!jid.client) c.problems.push({ severity: 'warning', file: file.name, row, message: 'No J-ID column: running this import again can’t recognise this client' })
            const add = (label: string, value: string | null | undefined) => {
              if (value && value.trim()) c!.custom.push({ entity: 'customer', label, value: value.trim() })
            }
            if (isCompany && f.company && f.company !== name) add('Company', f.company)
            if (isCompany && person && person !== name) add('Contact person', person)
            add('Tags', f.tags)
            add('Lead source', f.lead_source)
            add('Other phones', c.extraPhones.join(', '))
            add('Other emails', c.extraEmails.join(', '))
            if (c.archived) add('Archived in Jobber', 'Yes')
            for (const cv of m.custom.filter((x) => x.entity === 'customer')) add(cv.label, cv.value)
            if (notes.length) add('Notes from Jobber', notes.join('\n'))
            clientsById.set(clientId, c)
            out.clients.push(c)
          } else {
            // A second row of the same client = another property. Customer-level columns repeat; values it adds are kept.
            for (const cv of m.custom.filter((x) => x.entity === 'customer'))
              if (!c.custom.some((x) => x.label.toLowerCase() === cv.label.toLowerCase())) c.custom.push(cv)
          }
          for (const k of ['main_phone', 'mobile_phone', 'home_phone', 'work_phone', 'other_phone', 'sms_phone']) excelDamage(where, 'Phone', f[k], 'phone', problems)
          excelDamage(where, 'Service ZIP', f.service_zip, 'zip', problems)
          excelDamage(where, 'Billing ZIP', f.billing_zip, 'zip', problems)
          const service = addr(f, 'service')
          if (service.line1) {
            c.properties.push({
              // "103_" (no property part) or no J-ID: numbered within the client, so two such rows never collide.
              sourceId: jid.client && jid.property ? `${jid.client}_${jid.property}` : `${clientId}:${c.properties.length + 1}`,
              where,
              label: f.property_name?.slice(0, 80) || null,
              address: service,
              custom: m.custom.filter((x) => x.entity === 'property'),
            })
          } else if (m.custom.some((x) => x.entity === 'property')) {
            c.problems.push({ severity: 'warning', file: file.name, row, message: 'Property fields on a row with no service address — left out' })
          }
          break
        }
        case 'quotes':
          if (!f.quote_number) {
            problems.push({ severity: 'warning', file: file.name, row, message: 'No quote number — row left out' })
            break
          }
          out.quotes.push({
            where,
            number: f.quote_number,
            who: contact(f),
            title: f.title ?? null,
            status: f.status ?? null,
            lines: f.line_items ?? null,
            totalCents: moneyOf(where, 'Total', f.total),
            dates: { drafted: dateOf(where, 'Drafted date', f.drafted), sent: dateOf(where, 'Sent date', f.sent), approved: dateOf(where, 'Approved date', f.approved), converted: dateOf(where, 'Converted date', f.converted) },
            notes,
          })
          break
        case 'recurring_jobs':
          if (!f.job_number) {
            problems.push({ severity: 'warning', file: file.name, row, message: 'No job number — row left out' })
            break
          }
          out.recurring.push({
            where,
            number: f.job_number,
            who: contact(f),
            title: f.title ?? null,
            billingType: f.billing_type ?? null,
            lines: parseLineItems(f.line_items),
            linesText: f.line_items ?? null,
            totalCents: moneyOf(where, 'Total', f.total),
            start: dateOf(where, 'Schedule start date', f.start),
            end: dateOf(where, 'Schedule end date', f.end),
            frequencyText: f.frequency ?? null,
            notes,
          })
          break
        case 'one_off_jobs':
          if (!f.job_number) {
            problems.push({ severity: 'warning', file: file.name, row, message: 'No job number — row left out' })
            break
          }
          out.oneOff.push({
            where,
            number: f.job_number,
            who: contact(f),
            title: f.title ?? null,
            lines: f.line_items ?? null,
            totalCents: moneyOf(where, 'Total', f.total),
            dates: { created: dateOf(where, 'Created date', f.created), start: dateOf(where, 'Schedule start date', f.start), closed: dateOf(where, 'Closed date', f.closed) },
            notes,
          })
          break
        case 'visits': {
          const d = dateOf(where, 'Date', f.date)
          if (f.job_number && d) visitDates.set(f.job_number, [...(visitDates.get(f.job_number) ?? []), d])
          break
        }
        case 'invoices':
          excelDamage(where, 'Client phone', f.client_phone, 'phone', problems)
          if (!f.invoice_number) {
            problems.push({ severity: 'warning', file: file.name, row, message: 'No invoice number — row left out' })
            break
          }
          out.invoices.push({
            where,
            number: f.invoice_number.replace(/^#/, '').trim(),
            who: contact(f),
            subject: f.subject ?? null,
            status: f.status ?? null,
            issued: dateOf(where, 'Issued date', f.issued),
            due: dateOf(where, 'Due date', f.due),
            paidDate: dateOf(where, 'Marked paid date', f.paid_date),
            created: dateOf(where, 'Created date', f.created),
            jobNumbers: f.job_numbers ?? null,
            lines: parseLineItems(f.line_items),
            linesText: f.line_items ?? null,
            totalCents: moneyOf(where, 'Total', f.total),
            balanceCents: moneyOf(where, 'Balance', f.balance),
            taxCents: moneyOf(where, 'Tax amount', f.tax_amount),
            taxPercent: (() => {
              const n = numberValue(f.tax_percent)
              return n === null || Number.isNaN(n) ? null : n
            })(),
            notes,
          })
          break
        case 'products': {
          if (!f.name) {
            problems.push({ severity: 'warning', file: file.name, row, message: 'No name — row left out' })
            break
          }
          out.products.push({
            where,
            name: f.name.slice(0, 200),
            description: f.description ?? null,
            priceCents: moneyOf(where, 'Unit price', f.unit_price),
            costCents: moneyOf(where, 'Unit cost', f.unit_cost),
            taxable: yesNo(f.taxable) === true,
            category: f.category ?? null,
            active: yesNo(f.active) !== false,
          })
          break
        }
      }
    }
  }
  return { ...out, visitDatesByJob: Object.fromEntries(visitDates) }
}

/**
 * Many files → one read. Clients split across Jobber's ~1,500-row files are joined by their Jobber id; a recurring job,
 * quote, one-off job or invoice that appears in two exports (overlapping date ranges, the same report twice) is kept once.
 */
export function mergeReads(parts: ReadPart[], dateOrder: ReadResult['dateOrder']): ReadResult {
  const problems: Problem[] = parts.flatMap((p) => p.problems)
  const clients = new Map<string, ClientRecord>()
  for (const c of parts.flatMap((p) => p.clients)) {
    const had = clients.get(c.sourceId)
    if (!had) {
      clients.set(c.sourceId, { ...c, properties: [...c.properties], custom: [...c.custom], problems: [...c.problems] })
      continue
    }
    for (const p of c.properties) if (!had.properties.some((x) => x.sourceId === p.sourceId)) had.properties.push(p)
    for (const v of c.custom) if (!had.custom.some((x) => x.label.toLowerCase() === v.label.toLowerCase())) had.custom.push(v)
  }
  const once = <T extends { number: string; where: Where }>(list: T[], what: string): T[] => {
    const seen = new Map<string, T>()
    for (const r of list) {
      const prev = seen.get(r.number)
      if (prev) problems.push({ severity: 'warning', file: r.where.file, row: r.where.row, message: `${what} #${r.number} is also in ${prev.where.file} row ${prev.where.row} — kept once` })
      else seen.set(r.number, r)
    }
    return Array.from(seen.values())
  }
  const visitDatesByJob = new Map<string, string[]>()
  for (const p of parts) for (const [job, dates] of Object.entries(p.visitDatesByJob)) visitDatesByJob.set(job, Array.from(new Set([...(visitDatesByJob.get(job) ?? []), ...dates])))
  if (dateOrder.conflicting && !dateOrder.chosen)
    problems.push({ severity: 'warning', file: 'All files', row: null, message: 'Some dates read day/month and others month/day — pick the order under “Dates” and check again' })
  return {
    clients: Array.from(clients.values()),
    quotes: once(parts.flatMap((p) => p.quotes), 'Quote'),
    recurring: once(parts.flatMap((p) => p.recurring), 'Job'),
    oneOff: once(parts.flatMap((p) => p.oneOff), 'Job'),
    invoices: once(parts.flatMap((p) => p.invoices), 'Invoice'),
    products: parts.flatMap((p) => p.products),
    visitDatesByJob,
    problems,
    dateOrder,
    files: parts.flatMap((p) => p.files),
  }
}

/** All files in one go (tests, small uploads). The Check does the same three steps one file per request. */
export function readJobberFiles(files: RunFile[], choices: Record<string, Record<string, unknown>>, options: Pick<ImportOptions, 'dateOrder'>): ReadResult {
  const order = decideDateOrder(files.map((f) => fileDateEvidence(f, choices[f.id])), options.dateOrder)
  return mergeReads(files.map((f) => readOneFile(f, choices[f.id], order.order)), order)
}

/** Every address the plan will compare (Check asks SQL for their "same address" keys in one call). */
export function addressesOf(read: ReadResult): string[] {
  const set = new Set<string>()
  for (const c of read.clients) {
    for (const p of c.properties) set.add(addressText(p.address))
    const b = addressText(c.billing)
    if (b) set.add(b)
  }
  for (const r of [...read.recurring, ...read.invoices, ...read.quotes, ...read.oneOff]) {
    const a = addressText(r.who.service)
    if (a) set.add(a)
  }
  set.delete('')
  return Array.from(set)
}

// ---------------------------------------------------------------------------------------------------------------------
// Pass 2: match and plan
// ---------------------------------------------------------------------------------------------------------------------

export type Duplicate = { reason: string; names: string[] }
export type PlanSummary = {
  files: ReadResult['files']
  dateOrder: ReadResult['dateOrder']
  counts: Record<ItemKind, Record<ItemAction, number>>
  newFields: Array<{ entity: CustomFieldEntity; label: string }>
  invoices: { open: number; openBalanceCents: number; paid: number; draft: number; void: number }
  plans: { total: number; fromVisits: number; ended: number }
  duplicates: Duplicate[]
  problems: Problem[]
  problemCount: { errors: number; warnings: number }
  nothingToImport: boolean
}

const PROBLEM_LIST_LIMIT = 500

type Builder = {
  items: PlanItem[]
  seq: Record<string, number>
}

function pushItem(b: Builder, item: Omit<PlanItem, 'rank' | 'seq'>): PlanItem {
  const seq = (b.seq[item.kind] = (b.seq[item.kind] ?? 0) + 1)
  const full = { ...item, rank: ITEM_RANK[item.kind], seq }
  b.items.push(full)
  return full
}

/** Jobber invoice status + its balance → ours. Bad debt = written off in Jobber = void here (reason says so). */
export function invoiceStatus(jobberStatus: string | null, totalCents: number, balanceCents: number): { status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void'; voidReason: string | null } {
  const s = (jobberStatus ?? '').toLowerCase()
  if (/draft/.test(s)) return { status: 'draft', voidReason: null }
  if (/bad debt/.test(s)) return { status: 'void', voidReason: 'Bad debt in Jobber' }
  if (/void|cancel/.test(s)) return { status: 'void', voidReason: `${jobberStatus} in Jobber` }
  if (balanceCents <= 0 && totalCents > 0) return { status: 'paid', voidReason: null }
  if (/paid/.test(s) && !/awaiting|past due|unpaid|partial/.test(s) && balanceCents <= 0) return { status: 'paid', voidReason: null }
  if (balanceCents < totalCents) return { status: 'partially_paid', voidReason: null }
  return { status: 'sent', voidReason: null }
}

export function buildPlan(read: ReadResult, existing: ExistingSnapshot, addressKeys: Map<string, string>, options: ImportOptions): { items: PlanItem[]; summary: PlanSummary } {
  const b: Builder = { items: [], seq: {} }
  const keyOf = (a: Address | string) => {
    const t = typeof a === 'string' ? a : addressText(a)
    return t ? addressKeys.get(t) ?? '' : ''
  }
  const duplicates: Duplicate[] = []

  // ---- custom fields: every label a value needs, matched to the company's fields by name ---------------------------
  const fieldByKey = new Map<string, CustomFieldDefinition & { import_source_id: string | null; isNew?: boolean }>()
  for (const d of existing.fieldDefs) fieldByKey.set(`${d.entity}:${d.label.toLowerCase()}`, d)
  const wantedFields = new Map<string, { entity: CustomFieldEntity; label: string }>()
  for (const c of read.clients) {
    for (const v of c.custom) wantedFields.set(`customer:${v.label.toLowerCase()}`, { entity: 'customer', label: v.label })
    for (const p of c.properties) for (const v of p.custom) wantedFields.set(`property:${v.label.toLowerCase()}`, { entity: 'property', label: v.label })
  }
  const perEntity: Record<string, number> = {}
  for (const d of existing.fieldDefs) perEntity[d.entity] = (perEntity[d.entity] ?? 0) + 1
  const newFields: PlanSummary['newFields'] = []
  const skippedFields = new Set<string>()
  for (const [key, w] of Array.from(wantedFields)) {
    const have = fieldByKey.get(key)
    if (have) {
      pushItem(b, { kind: 'custom_field', source_id: key, label: `${w.label} (${w.entity})`, action: 'link', target_id: have.id, payload: { entity: w.entity, label: have.label }, problems: have.active ? [] : [{ severity: 'warning', file: 'Clients', row: null, message: `Your field “${have.label}” is turned off — its values are kept but can’t be edited until you turn it on` }] })
      continue
    }
    perEntity[w.entity] = (perEntity[w.entity] ?? 0) + 1
    if (perEntity[w.entity] > CUSTOM_FIELD_LIMITS.perEntity) {
      skippedFields.add(key)
      pushItem(b, { kind: 'custom_field', source_id: key, label: w.label, action: 'skip', target_id: null, payload: { entity: w.entity, label: w.label }, problems: [{ severity: 'warning', file: 'Clients', row: null, message: `Already ${CUSTOM_FIELD_LIMITS.perEntity} ${w.entity} fields — “${w.label}” left out (choose “Don’t bring this over” or “Keep as a note” for some columns)` }] })
      continue
    }
    const def = { id: `new:${key}`, entity: w.entity, label: w.label.slice(0, CUSTOM_FIELD_LIMITS.label), field_type: 'text' as const, options: [], required: false, sort: 0, active: true, visible_to_field: false, import_source_id: key, isNew: true }
    fieldByKey.set(key, def)
    newFields.push({ entity: w.entity, label: def.label })
    pushItem(b, { kind: 'custom_field', source_id: key, label: `${def.label} (${w.entity})`, action: 'create', target_id: null, payload: { entity: w.entity, label: def.label, field_type: 'text' }, problems: [] })
  }
  /** Values for one record: { field source key → value }, checked by THE validator (lib/custom-fields.ts). */
  const fieldValues = (entity: CustomFieldEntity, values: CustomValue[], where: Where, problems: Problem[]): Record<string, string | number | boolean> => {
    const out: Record<string, string | number | boolean> = {}
    for (const v of values) {
      const key = `${entity}:${v.label.toLowerCase()}`
      const def = fieldByKey.get(key)
      if (!def || skippedFields.has(key)) continue
      let raw = v.value
      if (def.field_type === 'text' && raw.length > CUSTOM_FIELD_LIMITS.text) {
        problems.push({ severity: 'warning', file: where.file, row: where.row, message: `${def.label} was longer than ${CUSTOM_FIELD_LIMITS.text} characters — cut short` })
        raw = raw.slice(0, CUSTOM_FIELD_LIMITS.text)
      }
      const r = cleanFieldValue(def, def.field_type === 'date' ? parseDate(raw, read.dateOrder.order) ?? raw : raw)
      if (!r.ok) {
        problems.push({ severity: 'warning', file: where.file, row: where.row, message: `${r.error} — “${v.value.slice(0, 60)}” left out` })
        continue
      }
      out[key] = r.value
    }
    return out
  }

  // ---- price book --------------------------------------------------------------------------------------------------
  const priceByName = new Map(existing.priceItems.map((p) => [nameKey(p.name), p]))
  const priceBySource = new Map(existing.priceItems.filter((p) => p.import_source_id).map((p) => [p.import_source_id!, p]))
  const seenProducts = new Set<string>()
  for (const p of read.products) {
    const source = `product:${nameKey(p.name)}`
    if (seenProducts.has(source)) {
      read.problems.push({ severity: 'warning', file: p.where.file, row: p.where.row, message: `“${p.name}” is in the file twice — the first one is used` })
      continue
    }
    seenProducts.add(source)
    const problems: Problem[] = []
    if (p.priceCents === null) problems.push({ severity: 'warning', file: p.where.file, row: p.where.row, message: `“${p.name}” has no price — set to $0.00` })
    const prior = priceBySource.get(source)
    const same = !prior ? priceByName.get(nameKey(p.name)) : undefined
    const payload = { name: p.name, description: p.description, unit_price_cents: Math.max(0, p.priceCents ?? 0), cost_cents: p.costCents, taxable: p.taxable, category: p.category, active: p.active }
    if (prior) pushItem(b, { kind: 'price_item', source_id: source, label: p.name, action: 'update', target_id: prior.id, payload, problems })
    else if (same) pushItem(b, { kind: 'price_item', source_id: source, label: p.name, action: 'skip', target_id: same.id, payload, problems: [{ severity: 'warning', file: p.where.file, row: p.where.row, message: `“${p.name}” is already in your price book — yours is kept` }] })
    else pushItem(b, { kind: 'price_item', source_id: source, label: p.name, action: 'create', target_id: null, payload, problems })
  }

  // ---- customers ---------------------------------------------------------------------------------------------------
  const custBySource = new Map(existing.customers.filter((c) => c.import_source_id).map((c) => [c.import_source_id!, c]))
  const customerItem = new Map<string, PlanItem>() // client source id → item
  /** Which client a report row means: email, phone, then name (+ street when names repeat). */
  const byEmail = new Map<string, ClientRecord[]>()
  const byPhone = new Map<string, ClientRecord[]>()
  const byName = new Map<string, ClientRecord[]>()
  const add = (m: Map<string, ClientRecord[]>, k: string | null, c: ClientRecord) => {
    if (k) m.set(k, [...(m.get(k) ?? []), c])
  }
  for (const c of read.clients) {
    for (const e of [c.email, ...c.extraEmails]) add(byEmail, e, c)
    for (const p of [c.phone, ...c.extraPhones]) add(byPhone, phoneDigits(p), c)
    add(byName, nameKey(c.name) || null, c)
  }
  // Duplicates inside Jobber (two clients, one email/phone): listed, both brought over as Jobber had them.
  const dupSeen = new Set<string>()
  for (const [k, list] of [...Array.from(byEmail).map(([k, l]) => [`email ${k}`, l] as const), ...Array.from(byPhone).map(([k, l]) => [`phone ${k}`, l] as const)]) {
    const distinct = Array.from(new Set(list))
    if (distinct.length < 2) continue
    const id = distinct.map((c) => c.sourceId).sort().join('|')
    if (dupSeen.has(id)) continue
    dupSeen.add(id)
    duplicates.push({ reason: `Same ${k.startsWith('email') ? 'email' : 'phone'} in Jobber (${k.slice(k.indexOf(' ') + 1)}) — both come over; merge later if they are one customer`, names: distinct.map((c) => c.name) })
  }

  const neededClients = new Set<string>()
  const matchClient = (who: ReportContact): ClientRecord | null => {
    const one = (l: ClientRecord[] | undefined) => (l && new Set(l).size === 1 ? l[0] : null)
    const e = who.email ? one(byEmail.get(who.email)) : null
    if (e) return e
    const p = phoneDigits(who.phone)
    const ph = p ? one(byPhone.get(p)) : null
    if (ph) return ph
    const named = byName.get(nameKey(who.name)) ?? []
    if (named.length === 1) return named[0]
    if (named.length > 1 && who.service.line1) {
      const k = keyOf(who.service)
      const hit = named.filter((c) => c.properties.some((pp) => keyOf(pp.address) === k))
      if (hit.length === 1) return hit[0]
    }
    return null
  }
  // Which clients a plan / invoice / quote needs (so "skip archived" never orphans one).
  for (const r of [...read.recurring, ...read.invoices]) {
    const c = matchClient(r.who)
    if (c) neededClients.add(c.sourceId)
  }

  const custPayload = (c: { name: string; email: string | null; phone: string | null; address_text: string | null }, custom: Record<string, unknown>) => ({
    name: c.name,
    email: c.email,
    phone: c.phone,
    address_text: c.address_text,
    custom_fields: custom,
  })

  for (const c of read.clients) {
    const problems = [...c.problems]
    const label = c.name || `Row ${c.where.row}`
    if (problems.some((p) => p.severity === 'error')) {
      customerItem.set(c.sourceId, pushItem(b, { kind: 'customer', source_id: c.sourceId, label, action: 'skip', target_id: null, payload: {}, problems }))
      continue
    }
    if (options.skipArchived && c.archived && !neededClients.has(c.sourceId)) {
      customerItem.set(c.sourceId, pushItem(b, { kind: 'customer', source_id: c.sourceId, label, action: 'skip', target_id: null, payload: {}, problems: [{ severity: 'warning', file: c.where.file, row: c.where.row, message: 'Archived in Jobber — left out (you chose to skip archived clients)' }] }))
      continue
    }
    const address_text = addressText(c.billing) || (c.properties[0] ? addressText(c.properties[0].address) : '') || null
    const custom = fieldValues('customer', c.custom, c.where, problems)
    const payload = custPayload({ name: c.name, email: c.email, phone: c.phone, address_text }, custom)
    const prior = custBySource.get(c.sourceId)
    if (prior) {
      customerItem.set(c.sourceId, pushItem(b, { kind: 'customer', source_id: c.sourceId, label, action: 'update', target_id: prior.id, payload, problems }))
      continue
    }
    const match = matchExistingCustomer(existing.customers, { name: c.name, email: c.email, phone: c.phone, address_text })
    if (match && match.import_source_id && match.import_source_id !== c.sourceId) {
      // Already brought over as ANOTHER Jobber client (two Jobber clients share an email/phone): keep them apart.
      customerItem.set(c.sourceId, pushItem(b, { kind: 'customer', source_id: c.sourceId, label, action: 'create', target_id: null, payload, problems }))
      continue
    }
    if (match) {
      duplicates.push({ reason: `Already in your customers (same ${match.email_lower && match.email_lower === c.email ? 'email' : phoneDigits(c.phone) && match.phone_normalized?.endsWith(phoneDigits(c.phone)!) ? 'phone' : 'name and address'}) — linked, only blank details filled`, names: [c.name, match.name ?? '(no name)'] })
      customerItem.set(c.sourceId, pushItem(b, { kind: 'customer', source_id: c.sourceId, label, action: 'link', target_id: match.id, payload, problems }))
      continue
    }
    customerItem.set(c.sourceId, pushItem(b, { kind: 'customer', source_id: c.sourceId, label, action: 'create', target_id: null, payload, problems }))
  }

  /** The customer a report row belongs to; makes one from the row when Jobber's client list didn't have it. */
  const stubItems = new Map<string, PlanItem>()
  const customerFor = (who: ReportContact, where: Where, problems: Problem[]): { ref: CustomerRef; customerId: string | null; client: ClientRecord | null } | null => {
    const c = matchClient(who)
    if (c) {
      const it = customerItem.get(c.sourceId)!
      if (it.action === 'skip') {
        problems.push({ severity: 'error', file: where.file, row: where.row, message: `Client “${c.name}” isn’t being brought over — left out` })
        return null
      }
      return { ref: { source_id: c.sourceId }, customerId: it.target_id, client: c }
    }
    if (!who.name && !who.email && !who.phone) {
      problems.push({ severity: 'error', file: where.file, row: where.row, message: 'No client name, email or phone — left out' })
      return null
    }
    const addrText = addressText(who.service) || null
    const match = matchExistingCustomer(existing.customers, { name: who.name ?? '', email: who.email, phone: who.phone, address_text: addrText })
    if (match) return { ref: { customer_id: match.id }, customerId: match.id, client: null }
    const source = `report:${nameKey(who.name)}:${who.email ?? phoneDigits(who.phone) ?? ''}`
    let stub = stubItems.get(source)
    if (!stub) {
      const prior = custBySource.get(source)
      stub = pushItem(b, {
        kind: 'customer',
        source_id: source,
        label: who.name || who.email || who.phone || 'Customer',
        action: prior ? 'update' : 'create',
        target_id: prior?.id ?? null,
        payload: custPayload({ name: (who.name || who.email || who.phone || 'Customer').slice(0, 120), email: who.email, phone: who.phone, address_text: addrText }, {}),
        problems: [{ severity: 'warning', file: where.file, row: where.row, message: `“${who.name ?? who.email}” isn’t in the clients file — a customer is made from this row` }],
      })
      stubItems.set(source, stub)
    }
    return { ref: { source_id: source }, customerId: stub.target_id, client: null }
  }

  // ---- properties --------------------------------------------------------------------------------------------------
  const propBySource = new Map(existing.properties.filter((p) => p.import_source_id).map((p) => [p.import_source_id!, p]))
  /** customer key ("src:<id>" or "id:<uuid>") → address key → property ref */
  const propIndex = new Map<string, Map<string, PropertyRef>>()
  const custKey = (ref: CustomerRef) => ('source_id' in ref ? `src:${ref.source_id}` : `id:${ref.customer_id}`)
  const indexProp = (ck: string, k: string, ref: PropertyRef) => {
    if (!k) return
    const m = propIndex.get(ck) ?? new Map()
    if (!m.has(k)) m.set(k, ref)
    propIndex.set(ck, m)
  }
  for (const p of existing.properties) indexProp(`id:${p.customer_id}`, p.address_key, { property_id: p.id })

  const propertyItem = (ref: CustomerRef, customerId: string | null, sourceId: string, a: Address, label: string | null, custom: CustomValue[], where: Where, extraProblems: Problem[] = []): PropertyRef | null => {
    const text = addressText(a)
    if (!a.line1 || !text) return null
    const k = keyOf(text)
    const ck = custKey(ref)
    // The same home twice for one customer (Jobber had it twice, or it is already on file): one property.
    const known = propIndex.get(ck)?.get(k) ?? (customerId ? propIndex.get(`id:${customerId}`)?.get(k) : undefined)
    if (known && !('source_id' in known && known.source_id === sourceId)) return known
    const problems = [...extraProblems]
    const values = fieldValues('property', custom, where, problems)
    const payload = { customer: ref, label, address_line1: a.line1, address_line2: a.line2, city: a.city, state: a.state, zip: a.zip, custom_fields: values }
    const prior = propBySource.get(sourceId)
    pushItem(b, { kind: 'property', source_id: sourceId, label: label ? `${label} · ${text}` : text, action: prior ? 'update' : 'create', target_id: prior?.id ?? null, payload, problems })
    const out = { source_id: sourceId }
    indexProp(ck, k, out)
    if (customerId) indexProp(`id:${customerId}`, k, out)
    return out
  }
  for (const c of read.clients) {
    const it = customerItem.get(c.sourceId)!
    if (it.action === 'skip') continue
    const ref = { source_id: c.sourceId }
    for (const p of c.properties) propertyItem(ref, it.target_id, p.sourceId, p.address, p.label, p.custom, p.where)
    if (c.properties.length === 0 && c.billing.line1) propertyItem(ref, it.target_id, `${c.sourceId}:billing`, c.billing, null, [], c.where)
  }
  const propertyFor = (cust: { ref: CustomerRef; customerId: string | null }, who: ReportContact, where: Where, tag: string): PropertyRef | null => {
    if (who.service.line1) return propertyItem(cust.ref, cust.customerId, `${tag}:${keyOf(who.service) || nameKey(addressText(who.service))}:${custKey(cust.ref)}`, who.service, null, [], where)
    // No service address on the report row: the customer's only property, if there is exactly one.
    const props = new Set(Array.from(propIndex.get(custKey(cust.ref))?.values() ?? []).map((r) => JSON.stringify(r)))
    if (cust.customerId) for (const r of Array.from(propIndex.get(`id:${cust.customerId}`)?.values() ?? [])) props.add(JSON.stringify(r))
    return props.size === 1 ? (JSON.parse(Array.from(props)[0]) as PropertyRef) : null
  }

  // ---- service plans from recurring jobs ---------------------------------------------------------------------------
  const planBySource = new Map(existing.plans.filter((p) => p.import_source_id).map((p) => [p.import_source_id!, p]))
  const tradeOk = options.trade && existing.trades.some((t) => t.slug === options.trade)
  let fromVisits = 0
  let endedPlans = 0
  for (const r of read.recurring) {
    const problems: Problem[] = []
    const source = `job:${r.number}`
    const label = `Job #${r.number}${r.title ? ` · ${r.title}` : ''}`
    const cust = customerFor(r.who, r.where, problems)
    const prop = cust ? propertyFor(cust, r.who, r.where, 'jobprop') : null
    if (cust && !prop) problems.push({ severity: 'error', file: r.where.file, row: r.where.row, message: 'No service address for this job — a plan needs a property. Left out.' })
    if (!tradeOk) problems.push({ severity: 'error', file: r.where.file, row: r.where.row, message: 'Pick the service type for imported plans (above) and check again' })
    const sched = inferSchedule({ visitDates: read.visitDatesByJob.get(r.number) ?? [], words: [r.frequencyText, r.title, r.linesText].filter(Boolean).join(' '), startDate: r.start })
    if (sched.source === 'visits') fromVisits += 1
    const review: string[] = [...sched.notes]
    const perVisit = !/fixed|job/i.test(r.billingType ?? '') // Jobber: "Per visit" vs a fixed price for the whole job
    let price: number | null = null
    const billing: BillingBasis = 'per_visit'
    if (perVisit && r.lines && r.lines.length) price = r.lines.reduce((s, l) => s + l.totalCents, 0) / 100
    else if (perVisit) review.push('No per-visit price in Jobber’s line items — add the price.')
    else review.push(`Billed as “${r.billingType}” in Jobber (${r.totalCents !== null ? `$${(r.totalCents / 100).toFixed(2)} for the whole job` : 'no total'}) — set the price and how it’s billed.`)
    review.push('Tax is off — turn it on if this service is taxable.')
    const start = r.start ?? options.today
    const end = r.end && r.end >= start ? r.end : null
    const ended = !!(end && end < options.today)
    if (ended) endedPlans += 1
    for (const n of review) problems.push({ severity: 'warning', file: r.where.file, row: r.where.row, message: n })
    const blocked = problems.some((p) => p.severity === 'error')
    const prior = planBySource.get(source)
    pushItem(b, {
      kind: 'plan',
      source_id: source,
      label,
      action: blocked ? 'skip' : prior ? 'update' : 'create',
      target_id: prior?.id ?? null,
      payload: blocked
        ? {}
        : {
            customer: cust!.ref,
            property: prop,
            trade: options.trade,
            name: (r.title || 'Service plan').slice(0, 120),
            description: [r.linesText ? `Jobber line items: ${r.linesText}` : null, ...r.notes].filter(Boolean).join('\n').slice(0, 2000) || null,
            price,
            billing_basis: billing,
            taxable: false,
            seasons: sched.seasons as Season[],
            preferred_weekday: sched.weekday,
            start_date: start,
            end_date: end,
            ended,
            review,
          },
      problems,
    })
  }

  // ---- invoices ----------------------------------------------------------------------------------------------------
  const invBySource = new Map(existing.invoices.filter((i) => i.import_source_id).map((i) => [i.import_source_id!, i]))
  const usedNumbers = new Set(existing.invoices.filter((i) => !i.import_source_id).map((i) => i.invoice_number.toLowerCase()))
  const invTotals = { open: 0, openBalanceCents: 0, paid: 0, draft: 0, void: 0 }
  const seenInvoices = new Set<string>()
  for (const inv of read.invoices) {
    const problems: Problem[] = []
    const source = `invoice:${inv.number}`
    if (seenInvoices.has(source)) {
      read.problems.push({ severity: 'warning', file: inv.where.file, row: inv.where.row, message: `Invoice #${inv.number} is in the files twice — the first one is used` })
      continue
    }
    seenInvoices.add(source)
    const label = `Invoice #${inv.number}`
    const cust = customerFor(inv.who, inv.where, problems)
    const prop = cust ? propertyFor(cust, inv.who, inv.where, 'invprop') : null
    if (inv.totalCents === null) problems.push({ severity: 'error', file: inv.where.file, row: inv.where.row, message: 'No total — left out' })
    const total = inv.totalCents ?? 0
    const tax = Math.max(0, inv.taxCents ?? 0)
    let balance = inv.balanceCents
    if (balance === null) {
      balance = /paid/i.test(inv.status ?? '') && !/awaiting|past due|unpaid|partial/i.test(inv.status ?? '') ? 0 : total
      problems.push({ severity: 'warning', file: inv.where.file, row: inv.where.row, message: `No balance column — read as ${balance === 0 ? 'paid' : 'unpaid'} from the status` })
    }
    if (balance > total) problems.push({ severity: 'warning', file: inv.where.file, row: inv.where.row, message: 'Balance is more than the total — imported with nothing paid' })
    if (total < 0) problems.push({ severity: 'error', file: inv.where.file, row: inv.where.row, message: 'Negative total (a credit) — left out; add it by hand' })
    const st = invoiceStatus(inv.status, total, Math.min(balance, total))
    const paidOutside = Math.max(0, total - Math.min(Math.max(balance, 0), total))
    // Lines: Jobber's own, then one line that makes them add up (discount / tip / rounding) — never a made-up price.
    const lines: Array<{ description: string; qty: number; unit_price_cents: number; line_total_cents: number; taxable: boolean }> = []
    if (inv.lines && inv.lines.length) {
      for (const l of inv.lines) {
        const qty = l.qty > 0 ? l.qty : 1
        lines.push({ description: l.name, qty, unit_price_cents: Math.round(l.totalCents / qty), line_total_cents: l.totalCents, taxable: tax > 0 })
      }
    } else {
      const sub = total - tax
      lines.push({ description: inv.linesText || inv.subject || `Jobber invoice #${inv.number}`, qty: 1, unit_price_cents: sub, line_total_cents: sub, taxable: tax > 0 })
      if (inv.linesText && inv.lines === null) problems.push({ severity: 'warning', file: inv.where.file, row: inv.where.row, message: 'Line items weren’t in Jobber’s “name (qty, $total)” shape — kept as one line' })
    }
    const subtotal = total - tax
    const diff = subtotal - lines.reduce((s, l) => s + l.line_total_cents, 0)
    if (diff !== 0) lines.push({ description: diff < 0 ? 'Discount (from Jobber)' : 'Tip / other (from Jobber)', qty: 1, unit_price_cents: diff, line_total_cents: diff, taxable: false })
    const blocked = !cust || problems.some((p) => p.severity === 'error')
    if (!blocked) {
      if (st.status === 'paid') invTotals.paid += 1
      else if (st.status === 'draft') invTotals.draft += 1
      else if (st.status === 'void') invTotals.void += 1
      else {
        invTotals.open += 1
        invTotals.openBalanceCents += total - paidOutside
      }
    }
    const prior = invBySource.get(source)
    // A re-run keeps the number the first import gave (it may be J-<n>); looked up by Jobber id, never by number.
    let number = prior ? prior.invoice_number : inv.number.slice(0, 60)
    if (!prior && usedNumbers.has(number.toLowerCase())) {
      number = `J-${number}`
      problems.push({ severity: 'warning', file: inv.where.file, row: inv.where.row, message: `You already have an invoice numbered ${inv.number} — this one comes in as ${number}` })
    }
    pushItem(b, {
      kind: 'invoice',
      source_id: source,
      label,
      action: blocked ? 'skip' : prior ? 'update' : 'create',
      target_id: prior?.id ?? null,
      payload: blocked
        ? {}
        : {
            customer: cust!.ref,
            property: prop,
            invoice_number: number,
            status: st.status,
            void_reason: st.voidReason,
            issued_at: inv.issued ?? inv.created,
            due_at: inv.due,
            subtotal_cents: subtotal,
            tax_cents: tax || null,
            tax_lines: tax ? [{ id: 'jobber', name: inv.taxPercent ? `Sales tax ${inv.taxPercent}% (Jobber)` : 'Sales tax (Jobber)', percent: inv.taxPercent ?? 0, amount_cents: tax }] : null,
            total_cents: total,
            paid_outside_cents: paidOutside || null,
            lines,
            public_note: inv.subject,
            internal_note: [
              `Brought over from Jobber: status “${inv.status ?? '—'}”, balance $${((total - paidOutside) / 100).toFixed(2)}${inv.paidDate ? `, marked paid ${inv.paidDate}` : ''}${inv.jobNumbers ? `, Jobber job #${inv.jobNumbers}` : ''}.`,
              paidOutside ? `$${(paidOutside / 100).toFixed(2)} was paid in Jobber (no payment details came over).` : null,
              ...inv.notes,
            ]
              .filter(Boolean)
              .join('\n')
              .slice(0, 4000),
          },
      problems,
    })
  }

  // ---- history (quotes, one-off jobs): kept on the customer as "From Jobber", no deals or jobs made ------------------
  for (const q of read.quotes) {
    const problems: Problem[] = []
    const cust = customerFor(q.who, q.where, problems)
    const open = /awaiting|draft|changes requested|sent/i.test(q.status ?? '') && !/approved|converted|archived/i.test(q.status ?? '')
    pushItem(b, {
      kind: 'history',
      source_id: `quote:${q.number}`,
      label: `Quote #${q.number}${q.title ? ` · ${q.title}` : ''}`,
      action: cust ? 'create' : 'skip',
      target_id: null,
      payload: cust ? { customer: cust.ref, type: 'quote', number: q.number, title: q.title, status: q.status, open, total_cents: q.totalCents, lines: q.lines, dates: q.dates, notes: q.notes } : {},
      problems,
    })
  }
  for (const j of read.oneOff) {
    const problems: Problem[] = []
    const cust = customerFor(j.who, j.where, problems)
    pushItem(b, {
      kind: 'history',
      source_id: `job:${j.number}`,
      label: `Job #${j.number}${j.title ? ` · ${j.title}` : ''}`,
      action: cust ? 'create' : 'skip',
      target_id: null,
      payload: cust ? { customer: cust.ref, type: 'job', number: j.number, title: j.title, open: !j.dates.closed, total_cents: j.totalCents, lines: j.lines, dates: j.dates, notes: j.notes } : {},
      problems,
    })
  }

  // ---- summary -----------------------------------------------------------------------------------------------------
  const kinds: ItemKind[] = ['custom_field', 'price_item', 'customer', 'property', 'plan', 'invoice', 'history']
  const counts = Object.fromEntries(kinds.map((k) => [k, { create: 0, update: 0, link: 0, skip: 0 }])) as PlanSummary['counts']
  for (const i of b.items) counts[i.kind][i.action] += 1
  const allProblems = [...read.problems, ...b.items.flatMap((i) => i.problems)]
  const errors = allProblems.filter((p) => p.severity === 'error').length
  return {
    items: b.items,
    summary: {
      files: read.files,
      dateOrder: read.dateOrder,
      counts,
      newFields,
      invoices: invTotals,
      plans: { total: counts.plan.create + counts.plan.update, fromVisits, ended: endedPlans },
      duplicates,
      problems: [...allProblems.filter((p) => p.severity === 'error'), ...allProblems.filter((p) => p.severity === 'warning')].slice(0, PROBLEM_LIST_LIMIT),
      problemCount: { errors, warnings: allProblems.length - errors },
      nothingToImport: !b.items.some((i) => i.action === 'create' || i.action === 'update' || (i.action === 'link' && i.kind === 'customer')),
    },
  }
}

export function kindLabel(kind: JobberFileKind): string {
  return JOBBER_FILE_KIND_LABELS[kind]
}
