/**
 * THE invoice as the customer sees it — one model for the printed page (/invoices/[id]/print) and the customer email
 * (lib/invoice-email.ts), so the two can't disagree. Company identity comes from the org row (lib/org-brand.ts), never
 * from code. Job invoices resolve "bill to" exactly as the print page always has (job customer → project customer →
 * latest proposal → "Customer"); invoices without a job (recurring service) bill their own customer at the invoice's
 * property (else the customer's address).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { formatPhone } from '@/lib/format'
import { resolveOrgBrand } from '@/lib/org-brand'
import { invoiceTaxRows } from '@/lib/sales-tax'
import type { JobInvoice, JobInvoiceItem } from '@/lib/types/invoices'

export interface InvoiceBillTo {
  name: string
  address: string
  email: string | null
  phone: string | null
  /** false = the job has no linked customer and the name/address came from a proposal or a placeholder. */
  isLinked: boolean
}

export interface InvoiceDocument {
  invoice: JobInvoice
  items: JobInvoiceItem[]
  appliedCents: number
  balanceCents: number
  isPaid: boolean
  taxRows: Array<{ label: string; amountCents: number }>
  company: { legalName: string; address: string; phone: string; email: string }
  billTo: InvoiceBillTo
}

/** Not a placeholder address (imports used `@none.com`, "none", "n/a"). */
export function isUsableCustomerEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.endsWith('@none.com')) return false
  if (trimmed === 'none' || trimmed === 'n/a') return false
  return trimmed.includes('@')
}

type CustomerRow = { name?: string | null; email?: string | null; phone?: string | null; address_text?: string | null } | null
type ProposalRow = { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null; customer_address?: string | null } | null

/** Pure: the job invoice "bill to" chain (unchanged from the original print page). */
export function resolveJobBillTo(jobCustomer: CustomerRow, projectCustomer: CustomerRow, proposal: ProposalRow, jobAddress: string): InvoiceBillTo {
  for (const c of [jobCustomer, projectCustomer]) {
    if (c?.name) {
      return {
        name: c.name,
        address: c.address_text || jobAddress,
        email: isUsableCustomerEmail(c.email) ? (c.email as string) : null,
        phone: c.phone || null,
        isLinked: true,
      }
    }
  }
  if (proposal?.customer_name) {
    return {
      name: proposal.customer_name,
      address: proposal.customer_address || jobAddress,
      email: isUsableCustomerEmail(proposal.customer_email) ? (proposal.customer_email as string) : null,
      phone: proposal.customer_phone || null,
      isLinked: false,
    }
  }
  return { name: 'Customer', address: jobAddress, email: null, phone: null, isLinked: false }
}

const INVOICE_WITH_JOB = '*, production_jobs!inner(org_id)'

/**
 * An invoice the caller's company may print, by id or by invoice number (numbers are unique per company only,
 * migration 202611100040). Job invoices scope through the job; invoices without a job through their own org_id.
 */
export async function findPrintableInvoice(admin: SupabaseClient, orgId: string, idOrNumber: string): Promise<JobInvoice | null> {
  if (!orgId || !idOrNumber) return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber)
  const strip = (row: Record<string, unknown> | null): JobInvoice | null => {
    if (!row) return null
    const { production_jobs: pj, ...rest } = row as Record<string, unknown> & { production_jobs?: { org_id?: string } | null }
    if (rest.job_id ? pj?.org_id !== orgId : rest.org_id !== orgId) return null
    return rest as unknown as JobInvoice
  }
  if (isUuid) {
    const { data } = await admin
      .from('job_invoices')
      .select(INVOICE_WITH_JOB)
      .eq('id', idOrNumber)
      .eq('production_jobs.org_id', orgId)
      .maybeSingle()
    const found = strip(data as Record<string, unknown> | null)
    if (found) return found
    const { data: own } = await admin.from('job_invoices').select('*').eq('id', idOrNumber).eq('org_id', orgId).is('job_id', null).maybeSingle()
    const ownFound = strip(own as Record<string, unknown> | null)
    if (ownFound) return ownFound
  }
  const { data: byNumber } = await admin
    .from('job_invoices')
    .select(INVOICE_WITH_JOB)
    .eq('invoice_number', idOrNumber)
    .eq('production_jobs.org_id', orgId)
    .maybeSingle()
  const numbered = strip(byNumber as Record<string, unknown> | null)
  if (numbered) return numbered
  const { data: ownByNumber } = await admin.from('job_invoices').select('*').eq('invoice_number', idOrNumber).eq('org_id', orgId).is('job_id', null).maybeSingle()
  return strip(ownByNumber as Record<string, unknown> | null)
}

async function billToForJob(admin: SupabaseClient, orgId: string, jobId: string): Promise<InvoiceBillTo> {
  // org-scope-ok: jobId is the parent job of an invoice findPrintableInvoice verified in orgId
  const { data: job } = await admin.from('production_jobs').select('id, address_text, customer_id, project_id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  const [jobCustomer, project] = await Promise.all([
    job?.customer_id
      ? admin.from('customers').select('name, email, phone, address_text').eq('id', job.customer_id).eq('org_id', orgId).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    job?.project_id ? admin.from('projects').select('id, customer_id').eq('id', job.project_id).eq('org_id', orgId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ])
  const [projectCustomer, proposal] = await Promise.all([
    project?.customer_id
      ? admin.from('customers').select('name, email, phone, address_text').eq('id', project.customer_id).eq('org_id', orgId).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    job?.project_id
      ? admin
          .from('proposals')
          .select('customer_name, customer_email, customer_phone, customer_address')
          .eq('project_id', job.project_id)
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ])
  return resolveJobBillTo(jobCustomer as CustomerRow, projectCustomer as CustomerRow, proposal as ProposalRow, (job?.address_text as string | null) || '')
}

async function billToForCustomer(admin: SupabaseClient, orgId: string, customerId: string, propertyId: string | null): Promise<InvoiceBillTo> {
  const [{ data: c }, property] = await Promise.all([
    admin.from('customers').select('name, email, phone, address_text').eq('id', customerId).eq('org_id', orgId).maybeSingle(),
    propertyId
      ? admin.from('properties').select('address_text').eq('id', propertyId).eq('org_id', orgId).maybeSingle().then((r) => r.data as { address_text?: string | null } | null)
      : Promise.resolve(null),
  ])
  const row = c as CustomerRow
  return {
    name: row?.name || 'Customer',
    address: property?.address_text || row?.address_text || '',
    email: isUsableCustomerEmail(row?.email) ? (row?.email as string) : null,
    phone: row?.phone || null,
    isLinked: !!row?.name,
  }
}

/** The whole document for an invoice already found in `orgId` (findOrgInvoice / findPrintableInvoice). */
export async function loadInvoiceDocument(admin: SupabaseClient, orgId: string, invoice: JobInvoice): Promise<InvoiceDocument> {
  const [itemsRes, appsRes, orgRes, billTo] = await Promise.all([
    admin.from('job_invoice_items').select('*').eq('invoice_id', invoice.id).order('sort_order', { ascending: true }),
    admin.from('invoice_payments').select('applied_cents').eq('invoice_id', invoice.id),
    admin.from('orgs').select('name, address, phone, email, settings').eq('id', orgId).maybeSingle(),
    invoice.job_id
      ? billToForJob(admin, orgId, invoice.job_id)
      : billToForCustomer(admin, orgId, String(invoice.customer_id), invoice.property_id ?? null),
  ])
  const appliedCents = ((appsRes.data ?? []) as Array<{ applied_cents: number }>).reduce((s, a) => s + a.applied_cents, 0)
  const balanceCents = invoice.total_cents - appliedCents
  const org = orgRes.data as { name?: string | null; address?: string | null; phone?: string | null; email?: string | null; settings?: Record<string, unknown> | null } | null
  // Invoices carry the legal entity name: settings.brand.legalName (owners edit it in Settings), else the company name.
  const brand = resolveOrgBrand(org)
  return {
    invoice,
    items: (itemsRes.data ?? []) as JobInvoiceItem[],
    appliedCents,
    balanceCents,
    isPaid: balanceCents <= 0,
    taxRows: invoiceTaxRows(invoice),
    company: {
      legalName: brand.legalName,
      address: brand.address,
      phone: org?.phone ? formatPhone(org.phone) : '',
      email: org?.email || '',
    },
    billTo,
  }
}
