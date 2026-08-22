import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncOrgEnrollments } from '@/lib/sync-444-core'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

type AuthResult = {
  userId: string
  orgId: string
}

type SessionData = {
  access_token?: string
}

// ── Auth helpers ───────────────────────────────────────────────────────────────

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getSessionFromRequest(req: NextRequest): SessionData | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] ?? ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(singleCookie.value))
      return isRecord(parsed) ? { access_token: String(parsed.access_token ?? '') } : null
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
    i += 1
  }

  if (chunks.length > 0) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(chunks.join('')))
      return isRecord(parsed) ? { access_token: String(parsed.access_token ?? '') } : null
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

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: sessionData?.access_token
      ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
      : undefined,
  })
}

async function assertAdmin(req: NextRequest): Promise<AuthResult | NextResponse> {
  const authClient = getAuthClient(req)
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()

  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.org_id) {
    return NextResponse.json({ error: 'No org found' }, { status: 400 })
  }

  return { userId: user.id, orgId: profile.org_id as string }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authResult = await assertAdmin(req)
    if (authResult instanceof NextResponse) return authResult

    const admin = createServiceClient()
    const result = await syncOrgEnrollments(admin, authResult.orgId, authResult.userId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
