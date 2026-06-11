import { type Metadata } from 'next'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string; inactive?: string }
}) {
  const nextParam = searchParams?.next || '/dashboard'
  const nextPath = nextParam.startsWith('/') ? nextParam : '/dashboard'
  const errorMessage = searchParams?.error || ''
  const inactiveSession =
    searchParams?.inactive === '1' || searchParams?.inactive === 'true'

  return (
    <div className="login-dark min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <div className="mb-6 text-center">
            <div className="mb-4 flex justify-center">
              <img
                src="/brand/arx-shield.png"
                alt="ARX Roofing & Exteriors"
                className="h-14 w-auto object-contain"
              />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              ARX Roofing & Exteriors
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
            <p className="mt-2 text-sm text-slate-400">
              Access your internal CRM and estimating tools.
            </p>
          </div>

          <form method="POST" action="/api/auth/login" className="space-y-4">
            {inactiveSession && !errorMessage ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
                Your account has been disabled. You cannot access the CRM. Contact your administrator if this is a
                mistake.
              </div>
            ) : null}
            {errorMessage ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                {errorMessage}
              </div>
            ) : null}

            <input type="hidden" name="next" value={nextPath} />

            <div>
              <label htmlFor="email" className="text-sm font-medium text-slate-200">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                placeholder="you@arxroofing.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-slate-200">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              Sign in
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-400">
            <span>Need help? </span>
            <Link href="/" className="text-indigo-300 hover:text-indigo-200">
              Back to landing page
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
