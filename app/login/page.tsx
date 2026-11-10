import { type Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AuthShell, {
  authButtonClass,
  authInputClass,
  authLabelClass,
  authNoticeClass,
} from '@/components/AuthShell'
import { authShellCompanyFor, loadLoginCompany } from '@/lib/company-login'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string; inactive?: string }
}) {
  const nextParam = searchParams?.next || '/today'
  const nextPath = nextParam.startsWith('/') ? nextParam : '/today'
  const errorMessage = searchParams?.error || ''
  const inactiveSession =
    searchParams?.inactive === '1' || searchParams?.inactive === 'true'

  // Whose login this is comes from the web address only (lib/company-login.ts).
  const login = await loadLoginCompany()
  if (login.state === 'unknown') notFound()
  const company = authShellCompanyFor(login)

  if (login.state === 'apex' || login.state === 'unavailable') {
    return (
      <AuthShell title="Sign in" company={company}>
        <div role="alert" className={authNoticeClass.warning}>
          {login.state === 'apex'
            ? "Open your company's web address to sign in. Ask your administrator if you don't have it."
            : 'Sign-in is unavailable right now. Please try again in a minute.'}
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your CRM and estimating tools."
      company={company}
      footer={
        <>
          <p>Forgot your password? Ask your administrator for a reset link.</p>
          {login.state === 'legacy' ? (
            <Link href="/" className="mt-3 inline-block text-[#E2BF73] hover:text-[#EBCD8B]">
              ← Back to home
            </Link>
          ) : null}
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
            placeholder="you@company.com"
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
