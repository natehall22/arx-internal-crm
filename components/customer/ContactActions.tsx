'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import {
  CONTACT_KIND_LABELS,
  CONTACT_OUTCOME_LABELS,
  OUTCOMES_FOR_KIND,
  type ContactKind,
  type ContactOutcome,
} from '@/lib/customer-contact'
import { telHref } from '@/lib/format'

const LONG_PRESS_MS = 550
/** Long enough for the phone/SMS app to take over first, so the question is waiting when they come back. */
const ASK_AFTER_MS = 700

export type LoggedContact = { kind: ContactKind; outcome: ContactOutcome; activityId: string | null }

/** A 44px button: tap runs the action, press-and-hold copies the value. */
function ActionLink({ href, label, value, icon, onTap }: { href: string; label: string; value: string; icon: string; onTap: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const [copied, setCopied] = useState(false)
  const start = () => {
    held.current = false
    timer.current = setTimeout(async () => {
      held.current = true
      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      } catch {
        window.prompt('Copy this:', value)
      }
    }, LONG_PRESS_MS)
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
  }
  return (
    <a
      href={href}
      aria-label={copied ? `${label} copied` : `${label}: ${value}. Hold to copy.`}
      title="Tap to open. Hold to copy."
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (held.current) e.preventDefault()
        else onTap()
      }}
      className="inline-flex h-11 min-w-[44px] select-none items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50"
    >
      <span aria-hidden>{icon}</span>
      <span className="sr-only sm:not-sr-only">{copied ? 'Copied' : label}</span>
    </a>
  )
}

/**
 * Call / Text / Email buttons that log themselves. Tapping one opens the phone, text or mail app as before; when the
 * person comes back, one tap records how it went (it becomes the job's "last customer contact"). "Log" records a
 * contact made from somewhere else (a personal phone, a visit). With no deal there is nowhere to log, so the
 * buttons just open the apps.
 */
export default function ContactActions({
  dealId,
  phone,
  email,
  surface = 'other',
  onLogged,
  showLog = true,
}: {
  dealId: string | null
  phone: string | null
  email: string | null
  surface?: 'job' | 'sales' | 'overview' | 'other'
  onLogged?: (c: LoggedContact) => void
  showLog?: boolean
}) {
  const router = useRouter()
  const [kind, setKind] = useState<ContactKind | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const clientId = useRef<string | null>(null)
  // A ref, not state: two taps in the same frame both see the old state and would log twice.
  const savingRef = useRef(false)

  const tel = phone ? telHref(phone) ?? `tel:${phone}` : null
  const sms = tel ? tel.replace(/^tel:/, 'sms:') : null

  const ask = (k: ContactKind, delay = ASK_AFTER_MS) => {
    if (!dealId) return
    clientId.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null
    setNote('')
    setTimeout(() => setKind(k), delay)
  }

  const save = async (outcome: ContactOutcome) => {
    if (!dealId || !kind || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const res = await fetch(`/api/threads/${dealId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: note, surface, contact: { kind, outcome }, clientId: clientId.current }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not log that')
        return
      }
      toast.success(`${CONTACT_KIND_LABELS[kind]} logged`)
      onLogged?.({ kind, outcome, activityId: (data.message?.id as string | undefined) ?? null })
      setKind(null)
      router.refresh()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {tel && phone && <ActionLink href={tel} label="Call" value={phone} icon="📞" onTap={() => ask('call')} />}
        {sms && phone && <ActionLink href={sms} label="Text" value={phone} icon="💬" onTap={() => ask('text')} />}
        {email && <ActionLink href={`mailto:${email}`} label="Email" value={email} icon="✉️" onTap={() => ask('email')} />}
        {showLog && dealId && (
          <button
            type="button"
            onClick={() => ask('call', 0)}
            className="inline-flex h-11 min-w-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50"
          >
            + Log contact
          </button>
        )}
      </div>

      <Dialog open={kind !== null} onOpenChange={(o) => !o && setKind(null)}>
        {kind && (
          <DialogContent title="How did it go?" description="One tap logs it on this customer.">
            <div role="radiogroup" aria-label="Contact type" className="flex flex-wrap gap-2">
              {(['call', 'text', 'email', 'visit'] as ContactKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={`inline-flex h-11 items-center rounded-full border px-4 text-base font-medium ${kind === k ? 'border-[#2c2c2a] bg-[#2c2c2a] text-white' : 'border-gray-300 bg-white text-[#2c2c2a]'}`}
                >
                  {CONTACT_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <label className="block text-sm font-medium text-[#2c2c2a]">
              Note (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-gray-300 p-2 text-base text-[#2c2c2a]"
                placeholder="e.g. Happy with the roof, call back in spring"
              />
            </label>
            <div className="grid gap-2">
              {OUTCOMES_FOR_KIND[kind].map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={saving}
                  onClick={() => save(o)}
                  className="inline-flex h-12 items-center justify-center rounded-lg bg-[#2c2c2a] px-4 text-base font-semibold text-white disabled:opacity-60"
                >
                  {CONTACT_OUTCOME_LABELS[o]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setKind(null)}
                className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-base font-medium text-[#2c2c2a] underline"
              >
                Don’t log
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
