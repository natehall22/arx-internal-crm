import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

const REP_LIKE_ROLES = new Set(['rep', 'sales_rep', 'closer'])

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email, phone, address_text')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (customerError) {
      console.error('Add-on opportunity customer lookup failed:', customerError)
      return NextResponse.json({ error: 'Failed to load customer' }, { status: 500 })
    }

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (REP_LIKE_ROLES.has(profile.role)) {
      const [{ data: ownedProjects }, { data: ownedOpportunities }] = await Promise.all([
        supabase
          .from('projects')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', customer.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
        supabase
          .from('opportunities')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', customer.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
      ])

      if ((ownedProjects || []).length === 0 && (ownedOpportunities || []).length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const now = new Date().toISOString()
    const { data: opportunity, error: insertError } = await supabase
      .from('opportunities')
      .insert({
        org_id: profile.org_id,
        customer_id: customer.id,
        lead_id: null,
        owner_user_id: profile.id,
        status: 'open',
        project_type: 'roofing',
        address_text: customer.address_text || null,
        notes: `Add-on opportunity created from customer file on ${new Date(now).toLocaleDateString()}. Use this for new post-completion scope with a separate proposal and Installation Agreement.`,
      })
      .select('id')
      .single()

    if (insertError || !opportunity?.id) {
      console.error('Add-on opportunity insert failed:', insertError)
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create add-on opportunity' },
        { status: 500 }
      )
    }

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      customer_id: customer.id,
      opportunity_id: opportunity.id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Add-on opportunity created for new post-completion scope.',
    })

    revalidatePath(`/customers/${customer.id}`)
    revalidatePath(`/customers/${customer.id}?tab=opportunities`)
    revalidatePath('/opportunities')

    return NextResponse.json({
      success: true,
      opportunity_id: opportunity.id,
    })
  } catch (error) {
    console.error('POST /api/customers/[id]/add-on-opportunity', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message === 'Unauthorized' || message === 'Account disabled' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
