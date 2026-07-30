import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canAccessCustomerRecordsFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import {
  buildIlikeFilterValue,
  formatOpportunityDetail,
  rankAndDedupeLinkTargets,
  type ReferralLinkTarget,
} from '@/lib/referral-links'

export const dynamic = 'force-dynamic'

const RESULT_LIMIT = 8

/**
 * Finds the record a referred person turned into, so a referral can be attached to
 * the deal it earned the bonus on. Distinct from `GET /api/referrals?q=`, which
 * searches the other direction — who *made* a referral.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const permissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canAccessCustomerRecordsFromPermissionNames(permissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const query = (request.nextUrl.searchParams.get('q') || '').trim()
    // The referring customer can't be their own referral.
    const excludeCustomerId = request.nextUrl.searchParams.get('exclude_customer_id')

    if (query.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const pattern = buildIlikeFilterValue(query)

    // Customers and leads match on the person; opportunities match on address, plus
    // any opportunity belonging to a matched customer/lead so a name search reaches
    // the deal even when the address was typed differently.
    let customersQuery = adminClient
      .from('customers')
      .select('id, name, phone, email, address_text')
      .eq('org_id', profile.org_id)
      .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},address_text.ilike.${pattern}`)
      .limit(RESULT_LIMIT)

    // Excluded in the query, not after, so the referrer can't consume a result slot.
    if (excludeCustomerId) {
      customersQuery = customersQuery.neq('id', excludeCustomerId)
    }

    const [customersResult, leadsResult] = await Promise.all([
      customersQuery,
      adminClient
        .from('leads')
        .select('id, homeowner_name, phone, email, address_text')
        .eq('org_id', profile.org_id)
        .or(`homeowner_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},address_text.ilike.${pattern}`)
        .limit(RESULT_LIMIT),
    ])

    const customers = customersResult.data || []
    const leads = leadsResult.data || []

    const matchedCustomerIds = customers.map((c) => c.id)
    const matchedLeadIds = leads.map((l) => l.id)

    const opportunityFilters = [`address_text.ilike.${pattern}`]
    if (matchedCustomerIds.length > 0) {
      opportunityFilters.push(`customer_id.in.(${matchedCustomerIds.join(',')})`)
    }
    if (matchedLeadIds.length > 0) {
      opportunityFilters.push(`lead_id.in.(${matchedLeadIds.join(',')})`)
    }

    const { data: opportunityRows } = await adminClient
      .from('opportunities')
      .select('id, address_text, status, project_type, customer_id, lead_id, customers(name), leads(homeowner_name)')
      .eq('org_id', profile.org_id)
      .or(opportunityFilters.join(','))
      .order('created_at', { ascending: false })
      .limit(RESULT_LIMIT)

    const opportunities: ReferralLinkTarget[] = (opportunityRows || []).map((row) => {
      const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
      const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads
      const name =
        (customer as { name?: string | null } | null)?.name ||
        (lead as { homeowner_name?: string | null } | null)?.homeowner_name ||
        row.address_text ||
        'Untitled opportunity'

      return {
        id: row.id,
        type: 'opportunity' as const,
        name,
        detail: formatOpportunityDetail(row),
        phone: null,
        email: null,
        address: row.address_text,
      }
    })

    const results = rankAndDedupeLinkTargets(
      [
        ...opportunities,
        ...customers.map((c) => ({
          id: c.id,
          type: 'customer' as const,
          name: c.name || 'Unnamed customer',
          detail: c.address_text,
          phone: c.phone,
          email: c.email,
          address: c.address_text,
        })),
        ...leads.map((l) => ({
          id: l.id,
          type: 'lead' as const,
          name: l.homeowner_name || 'Unnamed lead',
          detail: l.address_text,
          phone: l.phone,
          email: l.email,
          address: l.address_text,
        })),
      ],
      query
    ).slice(0, RESULT_LIMIT * 2)

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Referral link search error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search records' },
      { status: 500 }
    )
  }
}
