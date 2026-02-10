import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = cookies()
  const allCookies = cookieStore.getAll()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  let expectedCookieName = ''
  try {
    const host = new URL(supabaseUrl).hostname
    const projectRef = host.split('.')[0]
    expectedCookieName = projectRef ? `sb-${projectRef}-auth-token` : ''
  } catch {
    expectedCookieName = ''
  }
  const expectedCookie = expectedCookieName
    ? allCookies.find((cookie) => cookie.name === expectedCookieName)
    : undefined
  let cookieJson: any = null
  let cookieParseError: string | null = null
  if (expectedCookie?.value) {
    try {
      cookieJson = JSON.parse(expectedCookie.value)
    } catch (error) {
      cookieParseError = error instanceof Error ? error.message : 'Unknown parse error'
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // No-op in GET route - we're just reading
        },
      },
    }
  )

  const { data: userData, error: userError } = await supabase.auth.getUser()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  return NextResponse.json({
    user: userData?.user ? { id: userData.user.id, email: userData.user.email } : null,
    sessionUser: sessionData?.session?.user
      ? { id: sessionData.session.user.id, email: sessionData.session.user.email }
      : null,
    error: userError ? { message: userError.message, name: userError.name } : null,
    sessionError: sessionError ? { message: sessionError.message, name: sessionError.name } : null,
    expectedCookieName,
    expectedCookieLength: expectedCookie?.value?.length ?? 0,
    cookieParseError,
    cookieHasAccessToken: Boolean(cookieJson?.access_token),
    cookieHasRefreshToken: Boolean(cookieJson?.refresh_token),
    cookieExpiresAt: cookieJson?.expires_at ?? null,
    cookieNames: allCookies.map((cookie) => cookie.name),
  })
}