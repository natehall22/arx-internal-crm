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

function canViewOpportunity(profile: { role: string; id: string }, opportunity: { owner_user_id: string | null }) {
  if (profile.role === 'rep') {
    return opportunity.owner_user_id === profile.id
  }
  return true
}

export async function GET(request: NextRequest) {
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

    const admin = createServiceClient()

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { searchParams } = request.nextUrl
    const opportunityId = searchParams.get('opportunity_id')
    const closeId = searchParams.get('id')
    const scheduledAppointmentId = searchParams.get('scheduled_appointment_id')

    if (!opportunityId) {
      return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
    }

    const { data: opportunity, error: oppError } = await admin
      .from('opportunities')
      .select('id, org_id, owner_user_id, setter_user_id, address_text, lead_id, customer_id, leads(homeowner_name, phone), customers(name)')
      .eq('id', opportunityId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (oppError || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (!canViewOpportunity(profile, opportunity)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let closerName: string | null = null
    if (opportunity.owner_user_id) {
      const { data: closer } = await admin
        .from('users')
        .select('full_name')
        .eq('id', opportunity.owner_user_id)
        .maybeSingle()
      closerName = closer?.full_name || null
    }

    const customerName =
      (opportunity.leads as { homeowner_name?: string | null } | null)?.homeowner_name ||
      (opportunity.customers as { name?: string | null } | null)?.name ||
      null

    if (closeId) {
      const { data: closeRow, error: crErr } = await admin
        .from('close_appointments')
        .select('*')
        .eq('id', closeId)
        .eq('opportunity_id', opportunityId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (crErr || !closeRow) {
        return NextResponse.json({ error: 'Close appointment not found' }, { status: 404 })
      }

      return NextResponse.json({
        opportunity: {
          id: opportunity.id,
          address_text: opportunity.address_text,
          customer_name: customerName,
        },
        closer_name: closerName,
        close_appointment: closeRow,
        mode: 'close_row' as const,
      })
    }

    if (scheduledAppointmentId) {
      const { data: sa, error: saErr } = await admin
        .from('scheduled_appointments')
        .select('id, scheduled_for, opportunity_id, org_id, appointment_type')
        .eq('id', scheduledAppointmentId)
        .eq('opportunity_id', opportunityId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (saErr || !sa) {
        return NextResponse.json({ error: 'Scheduled appointment not found' }, { status: 404 })
      }

      return NextResponse.json({
        opportunity: {
          id: opportunity.id,
          address_text: opportunity.address_text,
          customer_name: customerName,
        },
        closer_name: closerName,
        scheduled_appointment: sa,
        mode: 'legacy_scheduled' as const,
      })
    }

    return NextResponse.json({ error: 'id or scheduled_appointment_id is required' }, { status: 400 })
  } catch (e) {
    console.error('GET /api/close-appointments/context', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
