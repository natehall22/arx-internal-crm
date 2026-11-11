import { isTimeAndMaterialsJob, syncTimeAndMaterialsCommissionBase } from '@/lib/job-commission-base'
import { invoiceHasBilledHours } from '@/lib/hourly-billing-db'
import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import {
  findOrgInvoice,
  getInvoiceWithDetails,
  addInvoiceItem,
  updateInvoiceItem,
  deleteInvoiceItem,
  finalizeAndSendInvoice,
  voidInvoice,
  duplicateInvoiceAsDraft,
  recordCustomerInvoicePayment,
  CUSTOMER_PAYMENT_METHODS,
  type CustomerPaymentMethod,
} from '@/lib/invoices'
import { sendCustomerInvoice } from '@/lib/invoice-email'
import type { JobInvoice } from '@/lib/types/invoices'
import { defaultTaxRates } from '@/lib/sales-tax'
import { loadOrgSalesTax } from '@/lib/sales-tax-server'

// GET - Get invoice with all details
export async function GET(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (!(await callerCanAccessJobBilling(adminClient, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const invoiceCheck = await findOrgInvoice(adminClient, params.invoiceId, profile.org_id)
    if (!invoiceCheck) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
    // Taxable box on lines only when this company charges sales tax with rates (lib/sales-tax.ts).
    const salesTax = await loadOrgSalesTax(adminClient, profile.org_id)
    // canMarkPaid: invoices without a job are paid right on the invoice (record_payment); job invoices use job payments.
    return NextResponse.json({ invoice, salesTaxOn: !!salesTax?.enabled && defaultTaxRates(salesTax).length > 0, canMarkPaid: !invoiceCheck.job_id })

  } catch (error) {
    console.error('Error in GET /api/invoices/[invoiceId]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update invoice (add item, send, void, etc.)
export async function PATCH(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (!(await callerCanAccessJobBilling(adminClient, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const invoiceCheck = await findOrgInvoice(adminClient, params.invoiceId, profile.org_id)
    if (!invoiceCheck) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action } = body
    // A job billed by the hour: its commission base is what it was invoiced (lib/job-commission-base.ts) — re-sync after
    // any change to one of its invoices. Fixed-price jobs are left alone (the helper checks).
    const resyncBase = () => syncTimeAndMaterialsCommissionBase(adminClient, profile.org_id, invoiceCheck.job_id)
    // Hours on a job billed by the hour come only from Hours to bill (one approval per day) — never typed onto an invoice.
    const hoursOnHourlyJob = async (unit: unknown) =>
      unit === 'hour' && !!invoiceCheck.job_id && (await isTimeAndMaterialsJob(adminClient, profile.org_id, invoiceCheck.job_id))

    switch (action) {
      case 'add_item': {
        const { description, qty, unit_price_cents, sort_order, taxable, unit, service_date } = body
        if (!description || unit_price_cents === undefined) {
          return NextResponse.json({ error: 'description and unit_price_cents required' }, { status: 400 })
        }
        if (await hoursOnHourlyJob(unit)) {
          return NextResponse.json({ error: 'This job is billed by the hour — bill hours from Hours to bill' }, { status: 409 })
        }
        const item = await addInvoiceItem(adminClient, params.invoiceId, {
          description,
          qty,
          unit_price_cents,
          sort_order,
          taxable: taxable === true,
          // Hours (time & materials): qty = hours, unit_price_cents = rate; service_date = the day worked.
          ...(unit === 'hour' ? { unit: 'hour' as const } : {}),
          ...(typeof service_date === 'string' && service_date ? { service_date } : {}),
        })
        await resyncBase()
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, item, invoice })
      }

      case 'update_item': {
        const { item_id, description, qty, unit_price_cents, sort_order, taxable } = body
        if (!item_id) {
          return NextResponse.json({ error: 'item_id required' }, { status: 400 })
        }
        const item = await updateInvoiceItem(adminClient, params.invoiceId, item_id, {
          description,
          qty,
          unit_price_cents,
          sort_order,
          ...(typeof taxable === 'boolean' ? { taxable } : {}),
        })
        await resyncBase()
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, item, invoice })
      }

      case 'delete_item': {
        const { item_id } = body
        if (!item_id) {
          return NextResponse.json({ error: 'item_id required' }, { status: 400 })
        }
        await deleteInvoiceItem(adminClient, params.invoiceId, item_id)
        await resyncBase()
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, invoice })
      }

      case 'send': {
        const { email } = body
        // An invoice without a job (recurring service) is really emailed to the customer (lib/invoice-email.ts); a job
        // invoice keeps its original behaviour (marked sent, nothing emailed).
        if (!invoiceCheck.job_id) {
          const current = await getInvoiceWithDetails(adminClient, params.invoiceId)
          if (!current) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
          const sent = await sendCustomerInvoice(adminClient, profile.org_id, current as JobInvoice, typeof email === 'string' ? email : null)
          if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
          return NextResponse.json({ success: true, invoice: sent.invoice })
        }
        if (!email) {
          return NextResponse.json({ error: 'email required' }, { status: 400 })
        }
        const invoice = await finalizeAndSendInvoice(adminClient, params.invoiceId, email)
        // Issued now: a time & materials job's commission base counts it (drafts don't).
        await resyncBase()
        return NextResponse.json({ success: true, invoice })
      }

      case 'record_payment': {
        // "Mark paid" on an invoice without a job — the one payment writer (a card processor's webhook will use it too).
        if (invoiceCheck.job_id) {
          return NextResponse.json({ error: 'Record job payments on the job' }, { status: 400 })
        }
        const { amount_cents, paid_at, method, note } = body
        const result = await recordCustomerInvoicePayment(adminClient, profile.org_id, params.invoiceId, {
          amountCents: Number(amount_cents),
          paidAt: typeof paid_at === 'string' ? paid_at : '',
          method: ((CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(method) ? method : '') as CustomerPaymentMethod,
          note: typeof note === 'string' ? note : null,
          createdBy: profile.id,
        })
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, invoice })
      }

      case 'void': {
        const { reason } = body
        if (!reason) {
          return NextResponse.json({ error: 'reason required' }, { status: 400 })
        }
        const invoice = await voidInvoice(adminClient, params.invoiceId, reason)
        await resyncBase()
        return NextResponse.json({ success: true, invoice })
      }

      case 'duplicate': {
        // Hours approved on Hours to bill are billed once: a copy would bill them again. Void, un-approve, approve again.
        if (await invoiceHasBilledHours(adminClient, profile.org_id, params.invoiceId)) {
          return NextResponse.json({ error: 'This invoice carries approved hours — void it, un-approve the days on Hours to bill, then bill them again there' }, { status: 409 })
        }
        const invoice = await duplicateInvoiceAsDraft(adminClient, params.invoiceId, profile.id)
        await resyncBase()
        return NextResponse.json({ success: true, invoice })
      }

      case 'update_notes': {
        const { notes, due_at, public_note, internal_note } = body
        if (invoiceCheck.status !== 'draft') {
          return NextResponse.json({ error: 'Can only update notes on draft invoices' }, { status: 400 })
        }
        const updateData: Record<string, any> = {}
        if (notes !== undefined) updateData.notes = notes
        if (due_at !== undefined) updateData.due_at = due_at
        if (public_note !== undefined) updateData.public_note = public_note
        if (internal_note !== undefined) updateData.internal_note = internal_note
        
        // org-scope-ok: params.invoiceId was verified in the caller's company by findOrgInvoice above; job_invoices.org_id filter after migration 202611100040
        const { data: updated, error } = await adminClient
          .from('job_invoices')
          .update(updateData)
          .eq('id', params.invoiceId)
          .select()
          .single()
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, invoice })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

  } catch (error) {
    console.error('Error in PATCH /api/invoices/[invoiceId]:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
