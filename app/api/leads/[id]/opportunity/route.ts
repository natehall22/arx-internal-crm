import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

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

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const sessionData = getSessionFromRequest(request)

    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${sessionData.access_token}` } },
    })

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(sessionData.access_token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const leadId = params.id
    let leadQuery = adminClient
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('org_id', profile.org_id)

    if (profile.role === 'rep') {
      leadQuery = leadQuery.eq('owner_user_id', profile.id)
    }

    const { data: lead, error: leadError } = await leadQuery.maybeSingle()

    if (leadError) {
      console.error('Create opportunity from lead — lead query error:', leadError)
      return NextResponse.json(
        { error: 'Could not load lead', details: leadError.message },
        { status: 500 }
      )
    }

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const { data: existingOpp } = await adminClient
      .from('opportunities')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingOpp?.id) {
      return NextResponse.json(
        { opportunity_id: existingOpp.id, already_exists: true },
        { status: 200 }
      )
    }

    const ownerUserId = lead.closer_user_id || profile.id
    const setterUserId = lead.owner_user_id || null

    // Omit `source` — some DBs have no `source` on opportunities (see canvass/lead insert).
    const { data: created, error: insertError } = await adminClient
      .from('opportunities')
      .insert({
        org_id: profile.org_id,
        lead_id: leadId,
        customer_id: (lead as { customer_id?: string | null }).customer_id || null,
        owner_user_id: ownerUserId,
        setter_user_id: setterUserId,
        status: 'open',
        project_type: 'roofing',
        address_text: lead.address_text || null,
        lat: lead.lat ?? null,
        lng: lead.lng ?? null,
        notes: lead.notes || null,
      })
      .select('id')
      .single()

    if (insertError || !created?.id) {
      console.error('Create opportunity from lead failed:', insertError)
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create opportunity' },
        { status: 500 }
      )
    }

    await adminClient
      .from('scheduled_appointments')
      .update({ opportunity_id: created.id })
      .eq('org_id', profile.org_id)
      .eq('lead_id', leadId)
      .is('opportunity_id', null)

    await adminClient.from('activities').insert({
      org_id: profile.org_id,
      lead_id: leadId,
      opportunity_id: created.id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Opportunity created manually from lead',
    })

    revalidatePath(`/leads/${leadId}`)
    revalidatePath('/opportunities')

    return NextResponse.json({ opportunity_id: created.id, already_exists: false })
  } catch (e) {
    console.error('POST /api/leads/[id]/opportunity', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
