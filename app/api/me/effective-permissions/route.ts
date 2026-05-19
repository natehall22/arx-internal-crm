import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(decodeURIComponent(singleCookie.value))
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  for (let i = 0; ; i++) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
  }
  if (chunks.length > 0) {
    try {
      return JSON.parse(decodeURIComponent(chunks.join('')))
    } catch {
      return null
    }
  }

  return null
}

export async function GET(request: NextRequest) {
  try {
    const sessionData = getSessionFromRequest(request)
    const accessToken: string | undefined = sessionData?.access_token

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const {
      data: { user },
      error: authError,
    } = await anon.auth.getUser(accessToken)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { fullAccess, permissionNames } = await resolveEffectivePermissionNames(admin, user.id, {
      role: profile.role as string,
      custom_role_id: profile.custom_role_id,
    })

    return NextResponse.json({
      fullAccess,
      permissions: Array.from(permissionNames).sort(),
    })
  } catch (e) {
    console.error('GET /api/me/effective-permissions', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
