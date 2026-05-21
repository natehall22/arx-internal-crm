'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

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
    <div className="login-dark min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <div className="mb-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              ARX Roofing & Exteriors
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Set new password</h1>
          </div>

          {tokenError ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              This reset link is invalid or has expired. Ask your administrator to send a new one.
            </div>
          ) : done ? (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
              Password updated! Redirecting to sign in…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                  {error}
                </div>
              )}
              <div>
                <label htmlFor="password" className="text-sm font-medium text-slate-200">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="text-sm font-medium text-slate-200">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                  placeholder="Repeat new password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Set password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
