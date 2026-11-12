'use client'

import { useCallback, useEffect, useState } from 'react'

import { toast } from '@/components/ui/toast'

type Status = {
  ready: boolean
  title?: string
  status?: 'sent' | 'viewed' | 'expired' | 'completed' | 'declined' | 'voided'
  statusLabel?: string
  sentAt?: string | null
  firstViewedAt?: string | null
  expiresAt?: string | null
  declineReason?: string | null
  voidReason?: string | null
  reminderCount?: number
  pdfSha256?: string | null
  hasCertificate?: boolean
  signedUrl?: string | null
  certificateUrl?: string | null
  customerEmail?: string | null
  remindersOn?: boolean
  extendDays?: number
}

const CHIP: Record<string, string> = {
  sent: 'bg-amber-100 text-amber-900',
  viewed: 'bg-blue-100 text-blue-900',
  expired: 'bg-gray-200 text-gray-900',
  completed: 'bg-green-100 text-green-900',
  declined: 'bg-red-100 text-red-900',
  voided: 'bg-gray-200 text-gray-900',
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '')

/**
 * Where a document sent for signature stands, with the office's one-tap actions: Resend (an expired link is extended first),
 * Extend, Void (a reason is required; kept, never deleted), the signed copy and the certificate. Used on every document kind
 * (`kind` = 'contract' | 'change-order'). Reads GET /api/signing/<kind>/<id>; acts through POST of the same address.
 */
export default function SigningStatus({ kind, id, refreshKey = 0 }: { kind: 'contract' | 'change-order'; id: string; refreshKey?: number }) {
  const [s, setS] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/signing/${kind}/${id}`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setS((await res.json()) as Status)
  }, [kind, id])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function act(action: string, extra: Record<string, unknown> = {}, ok?: string) {
    setBusy(action)
    const res = await fetch(`/api/signing/${kind}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) return toast.error(typeof data.message === 'string' ? data.message : 'That did not work')
    toast.success(ok ?? 'Done')
    setVoiding(false)
    setReason('')
    await load()
  }

  if (!s?.ready || !s.status) return null
  const open = s.status === 'sent' || s.status === 'viewed' || s.status === 'expired'
  const btn = 'min-h-[44px] rounded-lg border border-gray-400 bg-white px-3 text-sm font-medium text-[#2c2c2a] disabled:opacity-60'
  return (
    <div className="mt-3 border-t border-gray-200 pt-3 text-sm text-[#2c2c2a]" data-testid="signing-status">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${CHIP[s.status]}`}>{s.statusLabel}</span>
        <span>
          {s.sentAt ? `Sent ${day(s.sentAt)}` : ''}
          {s.firstViewedAt ? ` · Opened ${day(s.firstViewedAt)}` : open ? ' · Not opened yet' : ''}
          {open && s.expiresAt ? ` · ${s.status === 'expired' ? 'Expired' : 'Link works until'} ${day(s.expiresAt)}` : ''}
          {open && s.remindersOn && s.reminderCount ? ` · ${s.reminderCount} reminder${s.reminderCount > 1 ? 's' : ''} sent` : ''}
        </span>
      </div>
      {s.status === 'declined' && s.declineReason && <p className="mt-2">Customer’s reason: {s.declineReason}</p>}
      {s.status === 'voided' && s.voidReason && <p className="mt-2">Voided: {s.voidReason}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {open && (
          <>
            <button type="button" className={btn} disabled={!!busy || !s.customerEmail} onClick={() => act('resend', {}, 'Sent again')}>
              {busy === 'resend' ? 'Sending…' : s.status === 'expired' ? 'Extend and resend' : 'Resend'}
            </button>
            {s.status !== 'expired' && (
              <button type="button" className={btn} disabled={!!busy} onClick={() => act('extend', {}, `Link extended ${s.extendDays ?? 7} days`)}>
                Extend {s.extendDays ?? 7} days
              </button>
            )}
            <button type="button" className={btn} disabled={!!busy} onClick={() => setVoiding(true)}>Void</button>
          </>
        )}
        {s.status === 'completed' && s.certificateUrl && (
          <a className={`${btn} inline-flex items-center`} href={s.certificateUrl} target="_blank" rel="noopener noreferrer">Certificate</a>
        )}
        {s.status === 'completed' && !s.hasCertificate && (
          <button type="button" className={btn} disabled={!!busy} onClick={() => act('certificate', {}, 'Certificate made')}>Make certificate</button>
        )}
      </div>
      {open && !s.customerEmail && <p className="mt-2">No customer email on file: copy the link and send it yourself.</p>}
      {voiding && (
        <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
          <label className="block font-medium" htmlFor={`void-${id}`}>Why are you voiding this?</label>
          <textarea id={`void-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-400 p-2 text-base text-black" />
          <div className="mt-2 flex gap-2">
            <button type="button" className={`${btn} bg-gray-800 text-white`} disabled={!!busy || reason.trim().length < 3} onClick={() => act('void', { reason }, 'Voided')}>Void it</button>
            <button type="button" className={btn} onClick={() => setVoiding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {s.status === 'completed' && s.pdfSha256 && <p className="mt-2 break-all text-xs text-[#4b5563]">SHA-256 {s.pdfSha256}</p>}
    </div>
  )
}
