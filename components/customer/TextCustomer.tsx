'use client'

import { useCallback, useEffect, useState } from 'react'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { STAFF_TEXT_MAX } from '@/lib/sms/compliance'
import type { TextStatus } from '@/lib/sms/gate'

export type TextStatusPayload = { enabled: boolean; status: TextStatus | null; lastCameBy: 'sms' | null }

/**
 * May this deal's customer be texted? One small GET per screen that offers it (/api/threads/[dealId]/texting) — the same
 * rules the server applies when the text is sent, so a button never offers what would be refused. `record` saves "the
 * customer said it's OK" (who and when are stored server side) and refreshes the answer.
 */
export function useTextStatus(dealId: string | null, on: boolean) {
  const [data, setData] = useState<TextStatusPayload | null>(null)
  const load = useCallback(async () => {
    if (!dealId || !on) return
    const res = await fetch(`/api/threads/${dealId}/texting`).catch(() => null)
    if (res?.ok) setData((await res.json()) as TextStatusPayload)
  }, [dealId, on])
  useEffect(() => {
    void load()
  }, [load])
  const record = useCallback(
    async (how: 'phone' | 'in_person'): Promise<boolean> => {
      if (!dealId) return false
      const res = await fetch(`/api/threads/${dealId}/texting`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'record_consent', how }) }).catch(() => null)
      const j = (res ? await res.json().catch(() => ({})) : {}) as TextStatusPayload & { error?: string }
      if (!res || !res.ok) {
        toast.error(j.error || 'Could not save that')
        return false
      }
      setData(j)
      toast.success('Saved: they said it’s OK to text')
      return true
    },
    [dealId]
  )
  return { data, reload: load, record }
}

/** Shown instead of the Text box when the customer can't be texted yet: why, and the one fix staff have (record their OK). */
export function TextBlockedNotice({ status, onRecord }: { status: Extract<TextStatus, { state: 'blocked' }>; onRecord: (how: 'phone' | 'in_person') => Promise<boolean> }) {
  const [busy, setBusy] = useState(false)
  const go = async (how: 'phone' | 'in_person') => {
    setBusy(true)
    await onRecord(how)
    setBusy(false)
  }
  return (
    <div role="status" className="rounded-ui border border-surface-line bg-amber-50 p-3 text-ui-base text-ink">
      <p className="font-semibold">{status.message}</p>
      {status.canRecordConsent ? (
        <>
          <p className="mt-1 text-ui-sm">Did {status.name ? status.name.split(/\s+/)[0] : 'the customer'} say it’s OK to text{status.masked ? ` ${status.masked}` : ''}? Tap how, and we’ll keep a record of who asked and when.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void go('phone')} className="min-h-tap rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white disabled:opacity-60">
              They said OK by phone
            </button>
            <button type="button" disabled={busy} onClick={() => void go('in_person')} className="min-h-tap rounded-ui border border-surface-line bg-white px-4 text-ui-sm font-semibold text-ink disabled:opacity-60">
              They said OK in person
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * "Text customer" from the Call / Text / Email buttons: one small dialog, the message, Send. It is the thread's "To
 * customer" message sent by text (same server door), so it lands in the conversation and the customer sees it in their
 * account too. Cannot-text reasons show in place of the box.
 */
export function TextCustomerDialog({ dealId, open, onClose, onSent }: { dealId: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const { data, record } = useTextStatus(dealId, open)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [clientId] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())))
  const status = data?.status

  async function send() {
    if (!body.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/threads/${dealId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, audience: 'customer', channel: 'sms', clientId, surface: 'other' }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string; texted?: string }
      if (!res.ok) throw new Error(j.error || 'Not sent. Tap Send to try again.')
      toast.success(j.texted === 'queued' ? 'Saved. It will go out when texting hours start.' : 'Text sent')
      setBody('')
      onSent()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Not sent. Tap Send to try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Text the customer" description={status?.state === 'ready' ? `Goes to ${status.masked} from your company number.` : 'Texts go from your company number.'}>
        {!data ? (
          <p className="text-base text-[#2c2c2a]">Checking…</p>
        ) : status?.state === 'blocked' ? (
          <TextBlockedNotice status={status} onRecord={record} />
        ) : (
          <>
            <label className="block text-sm font-medium text-[#2c2c2a]">
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={STAFF_TEXT_MAX}
                rows={4}
                autoFocus
                className="mt-1 block w-full rounded-lg border border-gray-300 p-2 text-base text-[#2c2c2a]"
                placeholder="e.g. We’re running 20 minutes late. See you soon."
              />
            </label>
            <p className="text-sm text-[#2c2c2a]">{body.length}/{STAFF_TEXT_MAX}. The first text a number gets from you also says how to opt out.</p>
            {err ? <p role="alert" className="text-sm font-semibold text-red-700">{err}</p> : null}
            <button type="button" onClick={() => void send()} disabled={busy || !body.trim()} className="inline-flex h-12 items-center justify-center rounded-lg bg-[#2c2c2a] px-4 text-base font-semibold text-white disabled:opacity-60">
              {busy ? 'Sending…' : 'Send text'}
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-base font-medium text-[#2c2c2a] underline">
          Close
        </button>
      </DialogContent>
    </Dialog>
  )
}
