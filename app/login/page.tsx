import { type Metadata } from 'next'
import Link from 'next/link'
import AuthShell, { authButtonClass, authInputClass, authLabelClass, authNoticeClass } from '@/components/AuthShell'

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
    <AuthShell
      title="Sign in"
      subtitle="Your CRM and estimating tools."
      footer={
        <>
          <p>Forgot your password? Ask your administrator for a reset link.</p>
          <Link href="/" className="mt-3 inline-block text-[#E2BF73] hover:text-[#EBCD8B]">
            ← Back to home
          </Link>
        </>
      }
    >
      <form method="POST" action="/api/auth/login" className="space-y-5">
        {inactiveSession && !errorMessage ? (
          <div role="alert" className={authNoticeClass.warning}>
            Your account has been disabled. You cannot access the CRM. Contact your administrator if this is a
            mistake.
          </div>
        ) : null}
        {errorMessage ? (
          <div role="alert" className={authNoticeClass.error}>
            {errorMessage}
          </div>
        ) : null}

        <input type="hidden" name="next" value={nextPath} />

        <div>
          <label htmlFor="email" className={authLabelClass}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            required
            className={authInputClass}
            placeholder="you@arxroofing.com"
          />
        </div>

        <div>
          <label htmlFor="password" className={authLabelClass}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={authInputClass}
            placeholder="Enter your password"
          />
        </div>

        <button type="submit" className={authButtonClass}>
          Sign in
        </button>
      </form>
    </AuthShell>
  )
}
