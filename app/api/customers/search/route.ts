import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '').slice(-10)
}

// GET - Search customers by name/phone/email
export async function GET(request: Request) {
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

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customerPermissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canAccessCustomerRecordsFromPermissionNames(customerPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let allowedCustomerIds: string[] | null = null
    if (isRepLikeCustomerRecordRole(profile.role)) {
      const [{ data: projectRows }, { data: oppRows }] = await Promise.all([
        adminClient
          .from('projects')
          .select('customer_id')
          .eq('org_id', profile.org_id)
          .eq('owner_user_id', user.id)
          .not('customer_id', 'is', null),
        adminClient
          .from('opportunities')
          .select('customer_id')
          .eq('org_id', profile.org_id)
          .eq('owner_user_id', user.id)
          .not('customer_id', 'is', null),
      ])
      allowedCustomerIds = Array.from(
        new Set(
          [...(projectRows || []), ...(oppRows || [])]
            .map((row: { customer_id?: string | null }) => row.customer_id)
            .filter((id): id is string => Boolean(id))
        )
      )
      if (allowedCustomerIds.length === 0) {
        return NextResponse.json({ customers: [] })
      }
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim() || ''

    if (!query || query.length < 2) {
      return NextResponse.json({ customers: [] })
    }

    const normalizedPhone = normalizePhone(query)
    const emailLower = query.toLowerCase()

    // Search by name, phone, or email
    let customers: any[] = []

    // Try exact phone match first (if query looks like a phone)
    if (normalizedPhone.length >= 7) {
      const { data: phoneMatches } = await (() => {
        let q = adminClient
          .from('customers')
          .select('*')
          .eq('org_id', profile.org_id)
          .ilike('phone', `%${normalizedPhone.slice(-7)}%`)
        if (allowedCustomerIds) q = q.in('id', allowedCustomerIds)
        return q.limit(10)
      })()
      
      if (phoneMatches?.length) {
        customers = phoneMatches
      }
    }

    // Try email match
    if (customers.length === 0 && query.includes('@')) {
      const { data: emailMatches } = await (() => {
        let q = adminClient
          .from('customers')
          .select('*')
          .eq('org_id', profile.org_id)
          .ilike('email', `%${emailLower}%`)
        if (allowedCustomerIds) q = q.in('id', allowedCustomerIds)
        return q.limit(10)
      })()
      
      if (emailMatches?.length) {
        customers = emailMatches
      }
    }

    // Fall back to name search
    if (customers.length === 0) {
      const { data: nameMatches } = await (() => {
        let q = adminClient
          .from('customers')
          .select('*')
          .eq('org_id', profile.org_id)
          .ilike('name', `%${query}%`)
          .order('created_at', { ascending: false })
        if (allowedCustomerIds) q = q.in('id', allowedCustomerIds)
        return q.limit(10)
      })()
      
      customers = nameMatches || []
    }

    return NextResponse.json({ customers })

  } catch (error) {
    console.error('Error in GET /api/customers/search:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
