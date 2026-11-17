import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  mergeOrgInspectionOutcomesWithDefaults,
  sortInspectionOutcomes,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { createServiceClient } from '@/lib/supabase/service'
import { loadOrgProfile, profileOutcomeRows } from '@/lib/org-profile'

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

/** Active inspection outcomes for the signed-in user's org (closers + admins). */
export async function GET(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${sessionData.access_token}` } },
    })

    const { data: { user }, error: userError } = await authClient.auth.getUser(sessionData.access_token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createServiceClient()
    const { data: profile } = await admin
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { data: org } = await admin
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const includeInactive = request.nextUrl.searchParams.get('include_inactive') === '1'
    const raw = org?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    // The company's industry profile words the built-ins (lawn: no roof wording, no insurance follow-up); its own saved list wins.
    const orgProfile = await loadOrgProfile(admin, profile.org_id)
    const merged = mergeOrgInspectionOutcomesWithDefaults(raw, profileOutcomeRows(orgProfile, null, DEFAULT_INSPECTION_OUTCOMES))
    const outcomes = sortInspectionOutcomes(merged, { includeInactive })

    return NextResponse.json({ outcomes })
  } catch (error) {
    console.error('inspections/outcomes GET:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load outcomes' },
      { status: 500 }
    )
  }
}
