import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  url.pathname = '/login'
  return NextResponse.redirect(url, { status: 302 })
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  if (!supabaseUrl || !supabaseKey) {
    const errorUrl = new URL(req.url)
    errorUrl.pathname = '/login'
    errorUrl.searchParams.set('error', 'Server configuration error')
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  const formData = await req.formData()
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const nextPath =
    String(formData.get('next') ?? '/dashboard').startsWith('/')
      ? String(formData.get('next'))
      : '/dashboard'

  const redirectUrl = new URL(req.url)
  redirectUrl.pathname = nextPath
  redirectUrl.search = ''

  // CREATE RESPONSE FIRST
  const res = NextResponse.redirect(redirectUrl, { status: 303 })

  // Track if setAll was called
  let cookiesWereSet = false

  // SUPABASE WIRED DIRECTLY TO RESPONSE
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesWereSet = true
        console.log('LOGIN setAll called with', cookiesToSet.length, 'cookies:', cookiesToSet.map((c) => c.name))
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options)
        })
      },
    },
  })

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.log('LOGIN error:', error.message)
    const errorUrl = new URL(req.url)
    errorUrl.pathname = '/login'
    errorUrl.searchParams.set('error', error.message)
    errorUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  // If setAll wasn't called by signInWithPassword, manually set the session
  if (!cookiesWereSet && data.session) {
    console.log('LOGIN: setAll was NOT called, manually setting session')
    const { error: setError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
    if (setError) {
      console.log('LOGIN setSession error:', setError.message)
    }
  }

  // If still no cookies, something is very wrong - log it
  if (!cookiesWereSet) {
    console.log('LOGIN WARNING: No cookies were set after login!')
  }

  console.log('LOGIN success, returning response with cookies')
  return res
}
