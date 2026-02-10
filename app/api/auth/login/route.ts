import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/login', req.url))
}

export async function POST(request: NextRequest) {
  // All auth logic inside POST
  const { createServerClient } = await import('@supabase/ssr')
  
  const form = await request.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const rawNext = String(form.get('next') ?? '/dashboard')
  const nextPath = rawNext.startsWith('/') ? rawNext : '/dashboard'
  const isProd = process.env.NODE_ENV === 'production'

  // Create the redirect response FIRST so auth can set cookies on it
  let response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 })

  // Use cookies adapter on the response object being returned
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        secure: isProd,
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: Array<{ name: string; value: string; options?: any }>) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        }
      }
    }
  )

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const url = new URL('/login', request.url)
    url.searchParams.set('error', error.message)
    response = NextResponse.redirect(url, { status: 303 })
  }

  return response
}
