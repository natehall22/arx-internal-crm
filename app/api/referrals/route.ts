import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

// GET - Search for referrers (customers and leads) or get referral by lead_id
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')
    const leadId = searchParams.get('lead_id')
    const excludeLeadId = searchParams.get('exclude_lead_id')

    // If lead_id is provided, get the referral for that lead
    if (leadId) {
      const { data: referral } = await adminClient
        .from('referrals')
        .select('*')
        .eq('referred_lead_id', leadId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      return NextResponse.json({ referral })
    }

    // Search for referrers
    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const searchPattern = `%${query}%`

    // Search customers
    const { data: customers } = await adminClient
      .from('customers')
      .select('id, name, phone, email, address_text')
      .eq('org_id', profile.org_id)
      .or(`name.ilike.${searchPattern},phone.ilike.${searchPattern},email.ilike.${searchPattern},address_text.ilike.${searchPattern}`)
      .limit(10)

    // Search leads (only qualified ones)
    let leadsQuery = adminClient
      .from('leads')
      .select('id, homeowner_name, phone, email, address_text')
      .eq('org_id', profile.org_id)
      .in('status', ['won', 'appointment', 'inspection', 'estimate_sent'])
      .or(`homeowner_name.ilike.${searchPattern},phone.ilike.${searchPattern},email.ilike.${searchPattern},address_text.ilike.${searchPattern}`)
      .limit(10)

    if (excludeLeadId) {
      leadsQuery = leadsQuery.neq('id', excludeLeadId)
    }

    const { data: leads } = await leadsQuery

    interface ReferrerResult {
      id: string
      type: 'customer' | 'lead'
      name: string
      phone: string | null
      email: string | null
      address: string | null
    }

    const results: ReferrerResult[] = [
      ...(customers || []).map(c => ({
        id: c.id,
        type: 'customer' as const,
        name: c.name || 'Unnamed Customer',
        phone: c.phone,
        email: c.email,
        address: c.address_text,
      })),
      ...(leads || []).map(l => ({
        id: l.id,
        type: 'lead' as const,
        name: l.homeowner_name || 'Unnamed Lead',
        phone: l.phone,
        email: l.email,
        address: l.address_text,
      })),
    ]

    // Deduplicate by name+phone
    const seen = new Set<string>()
    const uniqueResults = results.filter(r => {
      const key = `${r.name}-${r.phone}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return NextResponse.json({ results: uniqueResults })
  } catch (error) {
    console.error('Referrals search API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to search referrers' 
    }, { status: 500 })
  }
}

// POST - Create a referral
export async function POST(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const { 
      referrer, 
      leadId, 
      leadName, 
      leadEmail, 
      leadPhone, 
      leadAddress, 
      bonusAmount 
    } = body

    // Ensure we have a customer ID for the referrer
    let referrerCustomerId = referrer.type === 'customer' ? referrer.id : null

    if (referrer.type === 'lead') {
      // Check if this lead has an associated customer by phone
      let existingCustomer = null
      if (referrer.phone) {
        const { data } = await adminClient
          .from('customers')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('phone', referrer.phone)
          .limit(1)
          .maybeSingle()
        existingCustomer = data
      }
      
      // If not found by phone, try by name
      if (!existingCustomer && referrer.name) {
        const { data } = await adminClient
          .from('customers')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('name', referrer.name)
          .limit(1)
          .maybeSingle()
        existingCustomer = data
      }

      if (existingCustomer) {
        referrerCustomerId = existingCustomer.id
      } else {
        // Create a new customer from the lead
        const { data: newCustomer } = await adminClient
          .from('customers')
          .insert({
            org_id: profile.org_id,
            name: referrer.name,
            phone: referrer.phone,
            email: referrer.email,
            address_text: referrer.address,
          })
          .select('id')
          .single()

        if (newCustomer) {
          referrerCustomerId = newCustomer.id
        }
      }
    }

    if (!referrerCustomerId) {
      return NextResponse.json({ error: 'Could not create referrer customer' }, { status: 400 })
    }

    // Create the referral
    const { data: referral, error: referralError } = await adminClient
      .from('referrals')
      .insert({
        org_id: profile.org_id,
        referrer_customer_id: referrerCustomerId,
        referrer_name: referrer.name,
        referrer_email: referrer.email,
        referrer_phone: referrer.phone,
        referred_name: leadName || 'Lead',
        referred_email: leadEmail,
        referred_phone: leadPhone,
        referred_address: leadAddress,
        referred_lead_id: leadId,
        bonus_amount: bonusAmount || 100,
        bonus_type: 'cash',
        status: 'pending',
      })
      .select()
      .single()

    if (referralError) {
      console.error('Referral creation error:', referralError)
      return NextResponse.json({ error: `Failed to create referral: ${referralError.message}` }, { status: 400 })
    }

    return NextResponse.json({ referral })
  } catch (error) {
    console.error('Referrals API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create referral' 
    }, { status: 500 })
  }
}

// DELETE - Remove a referral
export async function DELETE(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const referralId = searchParams.get('id')

    if (!referralId) {
      return NextResponse.json({ error: 'Referral ID required' }, { status: 400 })
    }

    const { error: deleteError } = await adminClient
      .from('referrals')
      .delete()
      .eq('id', referralId)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Referral delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete referral' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Referrals delete API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete referral' 
    }, { status: 500 })
  }
}
