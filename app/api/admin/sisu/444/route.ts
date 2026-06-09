import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { compute444WeekWindows } from '@/lib/program-444-utils'

export const dynamic = 'force-dynamic'

type AuthResult = {
  userId: string
  orgId: string
}

type SessionData = {
  access_token?: string
}

type PostBody = {
  user_id?: unknown
  start_date?: unknown
}

type PatchBody = {
  id?: unknown
  status?: unknown
  notes?: unknown
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

const ENROLLMENT_STATUSES = ['active', 'completed', 'cancelled']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getSessionFromRequest(req: NextRequest): SessionData | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
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

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
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

async function assertAdmin(req: NextRequest): Promise<AuthResult | NextResponse> {
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.org_id) {
    return NextResponse.json({ error: 'No org found' }, { status: 400 })
  }

  return { userId: user.id, orgId: profile.org_id }
}

async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())
}

export async function GET(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('program_444_enrollments')
    .select('*, users:users!program_444_enrollments_user_id_fkey(full_name, role)')
    .eq('org_id', authResult.orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enrollments: data ?? [] })
}

export async function POST(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const rawBody = await readJsonBody(req)
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const body: PostBody = rawBody
  if (typeof body.user_id !== 'string' || body.user_id.length === 0) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  if (typeof body.start_date !== 'string' || !isValidDateString(body.start_date)) {
    return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const windows = compute444WeekWindows(new Date(`${body.start_date}T12:00:00Z`))
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('program_444_enrollments')
    .insert({
      org_id: authResult.orgId,
      user_id: body.user_id,
      enrolled_by: authResult.userId,
      start_date: body.start_date,
      week1_starts_at: windows.week1StartsAt,
      week1_ends_at: windows.week1EndsAt,
      week2_starts_at: windows.week2StartsAt,
      week2_ends_at: windows.week2EndsAt,
    })
    .select('*, users:users!program_444_enrollments_user_id_fkey(full_name, role)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enrollment: data })
}

export async function PATCH(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const rawBody = await readJsonBody(req)
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const body: PatchBody = rawBody
  if (typeof body.id !== 'string' || body.id.length === 0) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const updates: Record<string, string | null> = {}

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !ENROLLMENT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
    }
    updates.notes = body.notes
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('program_444_enrollments')
    .update(updates)
    .eq('id', body.id)
    .eq('org_id', authResult.orgId)
    .select('*, users:users!program_444_enrollments_user_id_fkey(full_name, role)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enrollment: data })
}
