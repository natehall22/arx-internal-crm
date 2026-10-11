'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import AuthShell, { authButtonClass, authInputClass, authLabelClass, authNoticeClass } from '@/components/AuthShell'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [tokenError, setTokenError] = useState(false)

  useEffect(() => {
    // Supabase puts the recovery tokens in the URL hash after verifying the link
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const at = params.get('access_token')
    const rt = params.get('refresh_token')
    const type = params.get('type')

    if (!at || !rt || type !== 'recovery') {
      setTokenError(true)
      return
    }
    setAccessToken(at)
    setRefreshToken(rt)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!accessToken || !refreshToken) {
      setError('Invalid or expired reset link.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
      )

      // Establish the recovery session so updateUser is authorized
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (sessionError) throw sessionError

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setDone(true)
      setTimeout(() => router.push('/login'), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Set new password">
      {tokenError ? (
        <div role="alert" className={authNoticeClass.error}>
          This reset link is invalid or has expired. Ask your administrator to send a new one.
        </div>
      ) : done ? (
        <div className={authNoticeClass.success}>Password updated! Redirecting to sign in…</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className={authNoticeClass.error}>
              {error}
            </div>
          )}
          <div>
            <label htmlFor="password" className={authLabelClass}>
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label htmlFor="confirm" className={authLabelClass}>
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={authInputClass}
              placeholder="Repeat new password"
            />
          </div>
          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading ? 'Saving…' : 'Set password'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
