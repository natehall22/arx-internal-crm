import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

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
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
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
      const { data: phoneMatches } = await adminClient
        .from('customers')
        .select('*')
        .eq('org_id', profile.org_id)
        .ilike('phone', `%${normalizedPhone.slice(-7)}%`)
        .limit(10)
      
      if (phoneMatches?.length) {
        customers = phoneMatches
      }
    }

    // Try email match
    if (customers.length === 0 && query.includes('@')) {
      const { data: emailMatches } = await adminClient
        .from('customers')
        .select('*')
        .eq('org_id', profile.org_id)
        .ilike('email', `%${emailLower}%`)
        .limit(10)
      
      if (emailMatches?.length) {
        customers = emailMatches
      }
    }

    // Fall back to name search
    if (customers.length === 0) {
      const { data: nameMatches } = await adminClient
        .from('customers')
        .select('*')
        .eq('org_id', profile.org_id)
        .ilike('name', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(10)
      
      customers = nameMatches || []
    }

    return NextResponse.json({ customers })

  } catch (error) {
    console.error('Error in GET /api/customers/search:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
