import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const allCookies = request.cookies.getAll()
  const hasSupabaseCookie = allCookies.some((cookie) =>
    cookie.name.startsWith('sb-')
  )
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  let expectedCookieName = ''
  try {
    const host = new URL(supabaseUrl).hostname
    const projectRef = host.split('.')[0]
    expectedCookieName = projectRef ? `sb-${projectRef}-auth-token` : ''
  } catch {
    expectedCookieName = ''
  }
  const hasExpectedCookie = expectedCookieName
    ? allCookies.some((cookie) => cookie.name === expectedCookieName)
    : false

  return NextResponse.json({
    hasSupabaseCookie,
    expectedCookieName,
    hasExpectedCookie,
    cookieNames: allCookies.map((cookie) => cookie.name),
  })
}
