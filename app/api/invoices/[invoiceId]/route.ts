import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canAccessJobBilling } from '@/lib/finance-access'
import {
  getInvoiceWithDetails,
  addInvoiceItem,
  updateInvoiceItem,
  deleteInvoiceItem,
  finalizeAndSendInvoice,
  voidInvoice,
  duplicateInvoiceAsDraft,
} from '@/lib/invoices'

// GET - Get invoice with all details
export async function GET(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    if (!canAccessJobBilling({
      role: (profile as any).role,
      customRoleName: customRole?.name,
      customRoleDisplayName: customRole?.display_name,
    })) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify invoice belongs to user's org via job
    const { data: invoiceCheck } = await adminClient
      .from('job_invoices')
      .select('id, production_jobs!inner(org_id)')
      .eq('id', params.invoiceId)
      .single()

    if (!invoiceCheck || (invoiceCheck as any).production_jobs?.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
    return NextResponse.json({ invoice })

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
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id, custom_role:custom_roles(name, display_name)')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customRole = Array.isArray((profile as any).custom_role)
      ? (profile as any).custom_role[0]
      : (profile as any).custom_role

    if (!canAccessJobBilling({
      role: (profile as any).role,
      customRoleName: customRole?.name,
      customRoleDisplayName: customRole?.display_name,
    })) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify invoice belongs to user's org
    const { data: invoiceCheck } = await adminClient
      .from('job_invoices')
      .select('id, status, production_jobs!inner(org_id)')
      .eq('id', params.invoiceId)
      .single()

    if (!invoiceCheck || (invoiceCheck as any).production_jobs?.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action } = body

    switch (action) {
      case 'add_item': {
        const { description, qty, unit_price_cents, sort_order } = body
        if (!description || unit_price_cents === undefined) {
          return NextResponse.json({ error: 'description and unit_price_cents required' }, { status: 400 })
        }
        const item = await addInvoiceItem(adminClient, params.invoiceId, {
          description,
          qty,
          unit_price_cents,
          sort_order,
        })
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, item, invoice })
      }

      case 'update_item': {
        const { item_id, description, qty, unit_price_cents, sort_order } = body
        if (!item_id) {
          return NextResponse.json({ error: 'item_id required' }, { status: 400 })
        }
        const item = await updateInvoiceItem(adminClient, item_id, {
          description,
          qty,
          unit_price_cents,
          sort_order,
        })
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, item, invoice })
      }

      case 'delete_item': {
        const { item_id } = body
        if (!item_id) {
          return NextResponse.json({ error: 'item_id required' }, { status: 400 })
        }
        await deleteInvoiceItem(adminClient, item_id)
        const invoice = await getInvoiceWithDetails(adminClient, params.invoiceId)
        return NextResponse.json({ success: true, invoice })
      }

      case 'send': {
        const { email } = body
        if (!email) {
          return NextResponse.json({ error: 'email required' }, { status: 400 })
        }
        const invoice = await finalizeAndSendInvoice(adminClient, params.invoiceId, email)
        
        // Generate PDF after sending (fire and forget, don't block response)
        fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/invoices/${params.invoiceId}/pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(err => console.error('PDF generation error:', err))
        
        return NextResponse.json({ success: true, invoice })
      }

      case 'void': {
        const { reason } = body
        if (!reason) {
          return NextResponse.json({ error: 'reason required' }, { status: 400 })
        }
        const invoice = await voidInvoice(adminClient, params.invoiceId, reason)
        return NextResponse.json({ success: true, invoice })
      }

      case 'duplicate': {
        const invoice = await duplicateInvoiceAsDraft(adminClient, params.invoiceId, user.id)
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
