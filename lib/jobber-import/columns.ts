/**
 * Move from Jobber — what each Jobber CSV export looks like and how its columns map. Pure and client-safe.
 *
 * Header names come from Jobber's own help pages (cited in docs/jobber-import.md) and, for the client export, from a real
 * "Clients and properties" export used by an open-source importer (J-ID = "<client id>_<property id>", "Main Phone #s",
 * "E-mails", "Billing Street 1", "Service Zip code", custom fields as "CFS[Label]" / "CFT[Label]"). Jobber renames
 * columns now and then and its reports let people pick columns, so matching is tolerant: case, spaces, punctuation and
 * "#"/"($)" don't matter, several spellings are known per field, and any header we don't know is shown on the mapping
 * screen with a choice (a custom field, a note, or not used) instead of being dropped silently.
 */

export const JOBBER_FILE_KINDS = ['clients', 'quotes', 'recurring_jobs', 'one_off_jobs', 'visits', 'invoices', 'products'] as const
export type JobberFileKind = (typeof JOBBER_FILE_KINDS)[number]

/** Plain words for the upload list. */
export const JOBBER_FILE_KIND_LABELS: Record<JobberFileKind, string> = {
  clients: 'Clients & properties',
  quotes: 'Quotes',
  recurring_jobs: 'Recurring jobs',
  one_off_jobs: 'One-off jobs',
  visits: 'Visits',
  invoices: 'Invoices',
  products: 'Products & services (price book)',
}

/** Where a column's values go. A field key of the file's kind, a custom field, a note on the record, or nowhere. */
export type ColumnTarget = string | 'custom:customer' | 'custom:property' | 'note' | 'ignore'

type FieldDef = { key: string; label: string; aliases: string[] }

const SERVICE_ADDRESS: FieldDef[] = [
  { key: 'service_street1', label: 'Service street', aliases: ['Service Street 1', 'Service street', 'Service Street', 'Street', 'Address', 'Address 1', 'Property street'] },
  { key: 'service_street2', label: 'Service street line 2', aliases: ['Service Street 2', 'Address 2'] },
  { key: 'service_city', label: 'Service city', aliases: ['Service City', 'City'] },
  { key: 'service_state', label: 'Service state', aliases: ['Service State', 'Service state/province', 'State', 'Province'] },
  { key: 'service_zip', label: 'Service ZIP', aliases: ['Service Zip code', 'Service ZIP/postal code', 'Service zip/postal code', 'Zip code', 'ZIP', 'Postal code'] },
  { key: 'service_country', label: 'Service country', aliases: ['Service Country', 'Country'] },
]

const BILLING_ADDRESS: FieldDef[] = [
  { key: 'billing_street1', label: 'Billing street', aliases: ['Billing Street 1', 'Billing Street', 'Billing street'] },
  { key: 'billing_street2', label: 'Billing street line 2', aliases: ['Billing Street 2'] },
  { key: 'billing_city', label: 'Billing city', aliases: ['Billing City'] },
  { key: 'billing_state', label: 'Billing state', aliases: ['Billing State', 'Billing Province', 'Billing state/province'] },
  { key: 'billing_zip', label: 'Billing ZIP', aliases: ['Billing Zip code', 'Billing Zip', 'Billing Postal Code', 'Billing ZIP/postal code', 'Billing zip/postal code'] },
  { key: 'billing_country', label: 'Billing country', aliases: ['Billing Country'] },
]

const CLIENT_CONTACT: FieldDef[] = [
  { key: 'client_name', label: 'Client name', aliases: ['Client name', 'Client', 'Client Name'] },
  { key: 'client_email', label: 'Client email', aliases: ['Client email', 'Client email address'] },
  { key: 'client_phone', label: 'Client phone', aliases: ['Client phone', 'Client phone number'] },
]

export const JOBBER_FIELDS: Record<JobberFileKind, FieldDef[]> = {
  clients: [
    { key: 'jid', label: 'Jobber id', aliases: ['J-ID', 'J_ID', 'JID', 'Client ID', 'Client J-ID'] },
    { key: 'created', label: 'Created date', aliases: ['Created Date'] },
    { key: 'is_company', label: 'Is a company', aliases: ['Is Company?', 'Is Company'] },
    { key: 'display_name', label: 'Name', aliases: ['Display Name', 'Name', 'Client name'] },
    { key: 'company', label: 'Company name', aliases: ['Company Name', 'Company', 'Organization name', 'Org.'] },
    { key: 'title', label: 'Title', aliases: ['Title', 'Title (Mr, Ms or Mrs)'] },
    { key: 'first_name', label: 'First name', aliases: ['First Name', 'Given name'] },
    { key: 'last_name', label: 'Last name', aliases: ['Last Name', 'Family name'] },
    { key: 'full_name', label: 'Full name', aliases: ['Full name'] },
    { key: 'main_phone', label: 'Main phone', aliases: ['Main Phone #s', 'Main Phone', 'Phone'] },
    { key: 'mobile_phone', label: 'Mobile phone', aliases: ['Mobile Phone #s', 'Mobile Phone'] },
    { key: 'home_phone', label: 'Home phone', aliases: ['Home Phone #s', 'Home Phone'] },
    { key: 'work_phone', label: 'Work phone', aliases: ['Work Phone #s', 'Work Phone'] },
    { key: 'other_phone', label: 'Other phone', aliases: ['Other Phone #s', 'Other Phone'] },
    { key: 'sms_phone', label: 'Texting phone', aliases: ['Text Message Enabled Phone #', 'Text Message Enabled Phone Number'] },
    { key: 'emails', label: 'Email', aliases: ['E-mails', 'Emails', 'Email', 'E-mail'] },
    { key: 'tags', label: 'Tags', aliases: ['Tags'] },
    { key: 'lead_source', label: 'Lead source', aliases: ['Lead Source'] },
    { key: 'archived', label: 'Archived', aliases: ['Archived'] },
    { key: 'property_name', label: 'Property name', aliases: ['Service Property Name', 'Property Name'] },
    { key: 'note', label: 'Note', aliases: ['Note', 'Notes'] },
    ...BILLING_ADDRESS,
    ...SERVICE_ADDRESS,
  ],
  quotes: [
    { key: 'quote_number', label: 'Quote #', aliases: ['Quote #', 'Quote number', 'Quote'] },
    ...CLIENT_CONTACT,
    ...SERVICE_ADDRESS,
    { key: 'salesperson', label: 'Salesperson', aliases: ['Salesperson'] },
    { key: 'title', label: 'Title', aliases: ['Title'] },
    { key: 'status', label: 'Status', aliases: ['Status'] },
    { key: 'line_items', label: 'Line items', aliases: ['Line items'] },
    { key: 'subtotal', label: 'Subtotal', aliases: ['Subtotal ($)', 'Subtotal'] },
    { key: 'total', label: 'Total', aliases: ['Total ($)', 'Total'] },
    { key: 'discount', label: 'Discount', aliases: ['Discount ($)'] },
    { key: 'deposit_required', label: 'Required deposit', aliases: ['Required deposit ($)'] },
    { key: 'deposit_collected', label: 'Collected deposit', aliases: ['Collected deposit ($)'] },
    { key: 'job_numbers', label: 'Job #s', aliases: ['Job #s', 'Job #'] },
    { key: 'drafted', label: 'Drafted date', aliases: ['Drafted date'] },
    { key: 'sent', label: 'Sent date', aliases: ['Sent date'] },
    { key: 'approved', label: 'Approved date', aliases: ['Approved date'] },
    { key: 'converted', label: 'Converted date', aliases: ['Converted date'] },
    { key: 'archived_date', label: 'Archived date', aliases: ['Archived date'] },
  ],
  recurring_jobs: [
    { key: 'job_number', label: 'Job #', aliases: ['Job #', 'Job number'] },
    { key: 'title', label: 'Job title', aliases: ['Job title', 'Title'] },
    ...CLIENT_CONTACT,
    ...SERVICE_ADDRESS,
    ...BILLING_ADDRESS,
    { key: 'billing_type', label: 'Billing type', aliases: ['Billing type'] },
    { key: 'auto_invoice', label: 'Automatic invoicing', aliases: ['Automatic invoicing'] },
    { key: 'assigned', label: 'Visits assigned to', aliases: ['Visits assigned to'] },
    { key: 'line_items', label: 'Line items', aliases: ['Line items'] },
    { key: 'total', label: 'Total', aliases: ['Total ($)', 'Total'] },
    { key: 'completed_visits', label: 'Completed visits', aliases: ['Completed visits'] },
    { key: 'invoice_count', label: 'Number of invoices', aliases: ['Number of invoices'] },
    { key: 'start', label: 'Schedule start date', aliases: ['Schedule start date', 'Start date'] },
    { key: 'end', label: 'Schedule end date', aliases: ['Schedule end date', 'End date'] },
    { key: 'frequency', label: 'How often', aliases: ['Visit frequency', 'Frequency', 'Recurrence', 'Repeats'] },
  ],
  one_off_jobs: [
    { key: 'job_number', label: 'Job #', aliases: ['Job #', 'Job number'] },
    { key: 'title', label: 'Title', aliases: ['Title', 'Job title'] },
    { key: 'created', label: 'Created date', aliases: ['Created date'] },
    { key: 'lead_source', label: 'Lead source', aliases: ['Lead source'] },
    ...CLIENT_CONTACT,
    ...SERVICE_ADDRESS,
    ...BILLING_ADDRESS,
    { key: 'start', label: 'Schedule start date', aliases: ['Schedule start date'] },
    { key: 'closed', label: 'Closed date', aliases: ['Closed date'] },
    { key: 'assigned', label: 'Visits assigned to', aliases: ['Visits assigned to'] },
    { key: 'total', label: 'Total', aliases: ['Total revenue ($)', 'Total ($)', 'Total'] },
    { key: 'line_items', label: 'Line items', aliases: ['Line items'] },
    { key: 'invoice_numbers', label: 'Invoice #s', aliases: ['Invoice #s'] },
    { key: 'quote_number', label: 'Quote #', aliases: ['Quote #'] },
  ],
  visits: [
    { key: 'job_number', label: 'Job #', aliases: ['Job #', 'Job number'] },
    { key: 'date', label: 'Date', aliases: ['Date', 'Visit date', 'Start date'] },
    { key: 'title', label: 'Visit title', aliases: ['Visit title', 'Title'] },
    ...CLIENT_CONTACT,
    ...SERVICE_ADDRESS,
    { key: 'completed', label: 'Visit completed', aliases: ['Visit completed', 'Completed'] },
    { key: 'assigned', label: 'Assigned to', aliases: ['Assigned to'] },
    { key: 'line_items', label: 'Line items', aliases: ['Line items'] },
    { key: 'one_off_amount', label: 'One-off job ($)', aliases: ['One-off job ($)'] },
    { key: 'visit_amount', label: 'Visit based ($)', aliases: ['Visit based ($)'] },
    { key: 'job_type', label: 'Job type', aliases: ['Job type'] },
  ],
  invoices: [
    { key: 'invoice_number', label: 'Invoice #', aliases: ['Invoice #', 'Invoice number', 'Invoice'] },
    ...CLIENT_CONTACT,
    ...SERVICE_ADDRESS,
    ...BILLING_ADDRESS,
    { key: 'subject', label: 'Subject', aliases: ['Subject'] },
    { key: 'created', label: 'Created date', aliases: ['Created date'] },
    { key: 'issued', label: 'Issued date', aliases: ['Issued date'] },
    { key: 'due', label: 'Due date', aliases: ['Due date'] },
    { key: 'paid_date', label: 'Marked paid date', aliases: ['Marked paid date'] },
    { key: 'job_numbers', label: 'Job #s', aliases: ['Job #s', 'Job #'] },
    { key: 'status', label: 'Status', aliases: ['Status'] },
    { key: 'line_items', label: 'Line items', aliases: ['Line items'] },
    { key: 'total', label: 'Total', aliases: ['Total ($)', 'Total'] },
    { key: 'tip', label: 'Tip', aliases: ['Tip ($)'] },
    { key: 'balance', label: 'Balance', aliases: ['Balance ($)', 'Balance'] },
    { key: 'tax_percent', label: 'Tax (%)', aliases: ['Tax (%)'] },
    { key: 'deposit', label: 'Deposit', aliases: ['Deposit ($)'] },
    { key: 'discount', label: 'Discount', aliases: ['Discount ($)'] },
    { key: 'tax_amount', label: 'Tax amount', aliases: ['Tax amount ($)', 'Tax ($)'] },
  ],
  products: [
    { key: 'name', label: 'Name', aliases: ['Name', 'Product / Service', 'Item'] },
    { key: 'description', label: 'Description', aliases: ['Description'] },
    { key: 'unit_price', label: 'Unit price', aliases: ['Unit Price', 'Price', 'Default unit price'] },
    { key: 'unit_cost', label: 'Unit cost', aliases: ['Unit cost', 'Cost'] },
    { key: 'taxable', label: 'Taxable', aliases: ['Taxable'] },
    { key: 'category', label: 'Category', aliases: ['Category', 'Type'] },
    { key: 'active', label: 'Active', aliases: ['Active'] },
  ],
}

/**
 * Headers Jobber exports that a CRM customer has no use for (automatic-message switches, report counters). They are
 * recognised — so they don't sit on the mapping screen as "unknown" — and not imported.
 */
const KNOWN_UNUSED: string[] = [
  'Receives automatic visit reminders?',
  'Receives automatic job follow-ups?',
  'Receives automatic quote follow-ups?',
  'Receives automatic invoice follow-ups?',
  'Fax Phone #s',
  'Fax Phone',
  'Account Balance',
  'Sent quotes',
  'Sent quotes ($)',
  'Jobs',
  'Jobs ($)',
  'Sent invoices',
  'Sent invoices ($)',
  'Conversion rate',
  'Payment method on file',
  'Sent by user',
  'Viewed in client hub',
  'Sent to',
  'Days to paid',
  'Visits assigned to',
  'Scheduled duration',
  'Time tracked',
  'Online booking',
  'Quote discount ($)',
  'Expenses total ($)',
  'Labour cost total ($)',
  'Labor cost total ($)',
  'Line item cost total ($)',
  'Total costs ($)',
  'Profit ($)',
  'Profit %',
  'Changes requested date',
  'Bookable',
  'Duration mins',
  'Quantity enabled',
  'Minimum quantity',
  'Maximum quantity',
  'UTM source',
  'UTM medium',
  'UTM campaign',
  'UTM content',
]

/** "Main Phone #s" → "main phone number s"; "Total ($)" → "total". Case, spaces and punctuation never matter. */
export function headerKey(h: string): string {
  return h
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/\(\$\)|\(%\)/g, ' ')
    .replace(/#/g, ' number ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Jobber custom-field columns: "CFS[How often are your visits?]", "CFT[Referred By]" (prefix letters vary by type). */
export function customFieldLabel(header: string): string | null {
  const m = /^\s*CF[A-Z]{0,2}\s*\[(.+)\]\s*$/.exec(header)
  if (!m) return null
  const label = m[1].replace(/\s+/g, ' ').trim()
  return label ? label.slice(0, 60) : null
}

const UNUSED_KEYS = new Set(KNOWN_UNUSED.map(headerKey))

/** The field a header means in a file of this kind, or null. */
export function fieldForHeader(kind: JobberFileKind, header: string): string | null {
  const k = headerKey(header)
  for (const f of JOBBER_FIELDS[kind]) if (f.aliases.some((a) => headerKey(a) === k)) return f.key
  return null
}

export type HeaderMapping = { header: string; target: ColumnTarget; known: boolean; customLabel?: string }

/**
 * The starting mapping for a file: every header → field / custom field / ignore. `known: false` = we did not recognise it
 * and the owner should look (the mapping screen lists only those). Client files keep unknown columns as customer custom
 * fields by default (that is where Jobber's own custom fields and odd columns belong); other reports default to "not
 * used" — a quote's or invoice's extra column has no record to live on.
 */
export function defaultMapping(kind: JobberFileKind, headers: string[]): HeaderMapping[] {
  const used = new Set<string>()
  return headers.map((header) => {
    const cf = customFieldLabel(header)
    if (cf) return { header, target: kind === 'clients' ? 'custom:customer' : 'ignore', known: true, customLabel: cf }
    const field = fieldForHeader(kind, header)
    // The same field twice (e.g. "CFS[x]" and "CFS[X]", or two "Total" spellings): the first wins, later ones are shown.
    if (field && !used.has(field)) {
      used.add(field)
      return { header, target: field, known: true }
    }
    if (UNUSED_KEYS.has(headerKey(header))) return { header, target: 'ignore', known: true }
    if (!header.trim()) return { header, target: 'ignore', known: true }
    return { header, target: kind === 'clients' ? 'custom:customer' : 'ignore', known: false, customLabel: header.trim().slice(0, 60) }
  })
}

/** Which export a file is, from its headers (each kind has headers no other kind has). null = not a Jobber export we read. */
export function detectFileKind(headers: string[]): JobberFileKind | null {
  const keys = new Set(headers.map(headerKey))
  const has = (...names: string[]) => names.some((n) => keys.has(headerKey(n)))
  if (has('Invoice #') && has('Balance ($)', 'Balance', 'Total ($)', 'Status')) return 'invoices'
  if (has('Quote #') && has('Status', 'Total ($)', 'Line items', 'Approved date', 'Drafted date') && !has('Closed date')) return 'quotes'
  if (has('Job #') && has('Visit title', 'Visit completed', 'Visit based ($)', 'One-off job ($)')) return 'visits'
  if (has('Job #') && has('Schedule end date', 'Billing type', 'Completed visits', 'Automatic invoicing', 'Number of invoices')) return 'recurring_jobs'
  if (has('Job #') && has('Closed date', 'Total revenue ($)', 'Invoice #s', 'Created date', 'Schedule start date')) return 'one_off_jobs'
  if (has('J-ID', 'Display Name', 'Billing Street 1', 'E-mails', 'Main Phone #s', 'Is Company?', 'First Name')) return 'clients'
  if (has('Unit Price', 'Unit price') && has('Name')) return 'products'
  return null
}

/** Choices on the mapping screen for one header of a file of this kind. */
export function targetChoices(kind: JobberFileKind): Array<{ value: ColumnTarget; label: string }> {
  const base: Array<{ value: ColumnTarget; label: string }> = [{ value: 'ignore', label: 'Don’t bring this over' }]
  if (kind === 'clients') {
    base.push({ value: 'custom:customer', label: 'New customer field' }, { value: 'custom:property', label: 'New property field' })
  }
  base.push({ value: 'note', label: 'Keep as a note' })
  for (const f of JOBBER_FIELDS[kind]) base.push({ value: f.key, label: f.label })
  return base
}

export function isColumnTarget(kind: JobberFileKind, v: unknown): v is ColumnTarget {
  return typeof v === 'string' && targetChoices(kind).some((c) => c.value === v)
}

/**
 * Apply the owner's choices (from the mapping screen) on top of the default mapping. Choices for headers the file doesn't
 * have, or targets this kind doesn't offer, are ignored. Two headers pointing at the same field: the first in file order wins
 * (the later one becomes "not used", shown as such).
 */
export function resolveMapping(kind: JobberFileKind, headers: string[], choices: Record<string, unknown> | null | undefined): HeaderMapping[] {
  const base = defaultMapping(kind, headers)
  const seen = new Set<string>()
  return base.map((m) => {
    const chosen = choices?.[m.header]
    let target: ColumnTarget = isColumnTarget(kind, chosen) ? chosen : m.target
    const isField = !['ignore', 'note', 'custom:customer', 'custom:property'].includes(target)
    if (isField) {
      if (seen.has(target)) target = 'ignore'
      else seen.add(target)
    }
    return { ...m, target, customLabel: m.customLabel ?? customFieldLabel(m.header) ?? m.header.trim().slice(0, 60) }
  })
}

export type MappedRow = { fields: Record<string, string>; custom: Array<{ entity: 'customer' | 'property'; label: string; value: string }>; notes: string[] }

/** One CSV row through a mapping: field values, custom-field values, note lines. Blank cells are skipped. */
export function mapRow(mapping: HeaderMapping[], row: string[]): MappedRow {
  const out: MappedRow = { fields: {}, custom: [], notes: [] }
  mapping.forEach((m, i) => {
    const raw = (row[i] ?? '').trim()
    if (!raw || m.target === 'ignore') return
    if (m.target === 'note') out.notes.push(`${m.header.trim()}: ${raw}`)
    else if (m.target === 'custom:customer' || m.target === 'custom:property')
      out.custom.push({ entity: m.target === 'custom:customer' ? 'customer' : 'property', label: m.customLabel || m.header.trim(), value: raw })
    else if (!(m.target in out.fields)) out.fields[m.target] = raw
  })
  return out
}
