'use client'

import { useState } from 'react'

/** "Stop these emails" — one tap, then a plain confirmation. Works without the customer signing in. */
export default function StopEmails({ token, companyName, prominent }: { token: string; companyName: string; prominent: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  async function stop() {
    setState('busy')
    const res = await fetch(`/api/m/${token}/unsubscribe`, { method: 'POST' }).catch(() => null)
    setState(res && res.ok ? 'done' : 'error')
  }
  if (state === 'done') {
    return (
      <div role="status" className="rounded-xl border-2 border-[#2c2c2a] bg-white p-4 text-base text-[#2c2c2a]">
        <p className="font-bold">Done — you won’t get automatic emails from {companyName} anymore.</p>
        <p className="mt-1">Changed your mind? Just ask {companyName} to turn them back on.</p>
      </div>
    )
  }
  return (
    <div className={`rounded-xl border-2 bg-white p-4 text-base text-[#2c2c2a] ${prominent ? 'border-[#2c2c2a]' : 'border-[#e5e3dc]'}`}>
      <p className={prominent ? 'text-lg font-bold' : 'font-semibold'}>Stop automatic emails from {companyName}?</p>
      <p className="mt-1">Visit reminders, “on the way” and “done” notes, and quote and invoice reminders. Invoices the office sends you still arrive.</p>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={state === 'busy'}
        className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[#2c2c2a] px-4 text-base font-semibold text-white sm:w-auto"
      >
        {state === 'busy' ? 'Stopping…' : 'Stop these emails'}
      </button>
      {state === 'error' ? (
        <p role="alert" className="mt-2 font-semibold text-red-800">
          That didn’t work — please try again.
        </p>
      ) : null}
    </div>
  )
}
