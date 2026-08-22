import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_BADGES } from '@/lib/sisu-default-badges'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type SessionData = {
  access_token?: string
}

type UserProfile = {
  role: string | null
  org_id: string | null
}

const ADMIN_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

function isSessionData(value: unknown): value is SessionData {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (!('access_token' in value) || typeof value.access_token === 'string'),
  )
}

function parseSessionData(value: string): SessionData | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isSessionData(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getSessionFromRequest(req: NextRequest): SessionData | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    return parseSessionData(decodeURIComponent(singleCookie.value))
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i += 1
  }

  if (chunks.length > 0) {
    return parseSessionData(decodeURIComponent(chunks.join('')))
  }

  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: sessionData?.access_token
      ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
      : undefined,
  })
}

async function getAuthedUser(req: NextRequest) {
  const client = getAuthClient(req)
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user) return null
  return user
}

async function assertAdmin(req: NextRequest): Promise<{ userId: string; orgId: string } | NextResponse> {
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  const userProfile = profile as UserProfile | null
  if (!userProfile?.role || !userProfile.org_id || !ADMIN_ROLES.includes(userProfile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { userId: user.id, orgId: userProfile.org_id }
}

export async function POST(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const admin = createServiceClient()

  const { count, error: countError } = await admin
    .from('incentive_badges')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', authResult.orgId)

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })

  if ((count ?? 0) > 0) {
    return NextResponse.json({ seeded: false, reason: 'Badges already exist' })
  }

  const rows = DEFAULT_BADGES.map((badge) => ({
    ...badge,
    org_id: authResult.orgId,
  }))

  const { error: insertError } = await admin.from('incentive_badges').insert(rows)

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ seeded: true, count: rows.length })
}
