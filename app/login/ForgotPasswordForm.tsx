'use client'

import { useState } from 'react'

import { authButtonClass, authInputClass, authLabelClass, authNoticeClass } from '@/components/AuthShell'

/** Self-service reset: one email field. The server answers the same whether or not the email has an account. */
export default function ForgotPasswordForm() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    setError('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Enter a valid email.')
        setState('error')
        return
      }
      setState(res.ok ? 'sent' : 'error')
      if (!res.ok) setError('Something went wrong. Please try again.')
    } catch {
      setError('Something went wrong. Please try again.')
      setState('error')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center text-[#E2BF73] underline hover:text-[#EBCD8B]"
      >
        Forgot your password? Email me a reset link
      </button>
    )
  }

  if (state === 'sent') {
    return (
      <div role="status" className={authNoticeClass.warning}>
        If that email belongs to an account here, a reset link is on its way. It works for one hour.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      {state === 'error' && error ? (
        <div role="alert" className={authNoticeClass.error}>
          {error}
        </div>
      ) : null}
      <div>
        <label htmlFor="reset-email" className={authLabelClass}>
          Your email
        </label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInputClass}
          placeholder="you@company.com"
        />
      </div>
      <button type="submit" disabled={state === 'sending'} className={authButtonClass}>
        {state === 'sending' ? 'Sending…' : 'Email me a reset link'}
      </button>
    </form>
  )
}
