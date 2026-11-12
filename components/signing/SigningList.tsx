'use client'

import { useCallback, useEffect, useState } from 'react'

import { toast } from '@/components/ui/toast'

type Signer = { role_label?: string; role?: string; name: string; status: string; order_index?: number; order?: number }
type Item = { id: string; title: string; status: string; created_at: string; expires_at: string; signers: Signer[] }
type Template = { id: string; name: string; page_count: number; roles: Array<{ key: string; label: string }> }
type Detail = { id: string; title: string; status: string; statusLabel: string; signers: Array<{ id: string; role: string; name: string; email: string | null; status: string; signedAt: string | null }>; events: Array<{ event: string; at: string; actor: string; signer: string | null }>; hasSigned: boolean; hasCertificate: boolean; pdfSha256: string | null; voidReason: string | null; declineReason: string | null }

const CHIP: Record<string, string> = { pending: 'bg-amber-100 text-amber-900', sent: 'bg-amber-100 text-amber-900', viewed: 'bg-blue-100 text-blue-900', completed: 'bg-green-100 text-green-900', declined: 'bg-red-100 text-red-900', voided: 'bg-gray-200 text-gray-900', expired: 'bg-gray-200 text-gray-900' }
const LABEL: Record<string, string> = { pending: 'Waiting', sent: 'Sent', viewed: 'Opened', completed: 'Signed', declined: 'Declined', voided: 'Voided', expired: 'Expired', signed: 'Signed' }
const btn = 'min-h-[44px] rounded-lg border-2 border-gray-500 bg-white px-3 text-base font-semibold text-[#2c2c2a] disabled:opacity-60'
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '')

export default function SigningList() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [canManage, setCanManage] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [bulk, setBulk] = useState<Template | null>(null)

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/signing/requests', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null), fetch('/api/signing/templates', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)])
    setItems(a?.requests ?? [])
    setTemplates(b?.templates ?? [])
    setCanManage(!!b?.canManage)
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="mx-auto max-w-3xl space-y-6 text-[#2c2c2a]">
      <a href="/signing/new" className="flex min-h-[52px] items-center justify-center rounded-lg bg-gray-900 px-4 text-lg font-semibold text-white">Send a document for signature</a>

      <section aria-labelledby="tp">
        <div className="mb-2 flex items-center justify-between"><h2 id="tp" className="text-lg font-semibold">Templates</h2>{canManage && <a href="/signing/templates/new" className="min-h-[44px] py-2 text-base font-semibold underline">New template</a>}</div>
        {templates.length === 0 ? <p className="text-base">No templates yet. A template is a PDF with its signature fields already placed.</p> : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-gray-300 bg-white p-3">
                <span className="text-base font-semibold">{t.name}<span className="ml-2 font-normal">{t.page_count} page{t.page_count > 1 ? 's' : ''}</span></span>
                <span className="flex gap-2">
                  {t.roles.length === 1 && <button type="button" className={btn} onClick={() => setBulk(t)}>Send to many</button>}
                  <a className={`${btn} inline-flex items-center`} href={`/signing/new?template=${t.id}`}>Send</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rq">
        <h2 id="rq" className="mb-2 text-lg font-semibold">Out for signature</h2>
        {items === null && <p className="text-base">Loading…</p>}
        {items?.length === 0 && <p className="text-base">Nothing sent yet.</p>}
        <ul className="space-y-2">
          {items?.map((r) => (
            <li key={r.id} className="rounded-lg border-2 border-gray-300 bg-white">
              <button type="button" className="flex min-h-[56px] w-full items-center justify-between gap-2 p-3 text-left" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span><span className="block text-base font-semibold">{r.title}</span><span className="block text-base">{[...r.signers].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((s) => `${s.name} (${LABEL[s.status] ?? s.status})`).join(' · ')}</span></span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-sm font-semibold ${CHIP[r.status] ?? CHIP.pending}`}>{LABEL[r.status] ?? r.status}</span>
              </button>
              {open === r.id && <RequestDetail id={r.id} onChanged={load} />}
            </li>
          ))}
        </ul>
      </section>
      {bulk && <BulkDialog template={bulk} onClose={() => setBulk(null)} onDone={() => { setBulk(null); void load() }} />}
    </div>
  )
}

function RequestDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const load = useCallback(async () => { const r = await fetch(`/api/signing/requests/${id}`, { cache: 'no-store' }); if (r.ok) setD(await r.json()) }, [id])
  useEffect(() => { void load() }, [load])
  async function act(action: string, extra: Record<string, unknown> = {}, ok = 'Done') {
    setBusy(action + (extra.signerId ?? ''))
    const res = await fetch(`/api/signing/requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return toast.error(data.message || data.error || 'That did not work')
    toast.success(ok); setVoiding(false); setReason(''); await load(); onChanged()
  }
  if (!d) return <p className="p-3 text-base">Loading…</p>
  const open = d.status === 'pending' || d.status === 'sent' || d.status === 'viewed' || d.status === 'expired'
  return (
    <div className="border-t border-gray-300 p-3 text-base">
      <ul className="space-y-2">
        {d.signers.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
            <span><strong>{s.role}:</strong> {s.name} {s.email ? `· ${s.email}` : ''} · {LABEL[s.status] ?? s.status}{s.signedAt ? ` ${day(s.signedAt)}` : ''}</span>
            {open && s.status !== 'signed' && (
              <span className="flex gap-2">
                <button type="button" className={btn} disabled={!!busy} onClick={() => act('resend', { signerId: s.id }, 'Sent again')}>Resend</button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => act('remind', { signerId: s.id }, 'Reminder sent')}>Remind</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {d.declineReason && <p className="mt-2">Reason given: {d.declineReason}</p>}
      {d.voidReason && <p className="mt-2">Voided: {d.voidReason}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {d.hasSigned && <a className={`${btn} inline-flex items-center`} href={`/api/signing/requests/${id}/file?which=signed`}>Signed PDF</a>}
        {d.hasCertificate && <a className={`${btn} inline-flex items-center`} href={`/api/signing/requests/${id}/file?which=certificate`}>Certificate</a>}
        <a className={`${btn} inline-flex items-center`} href={`/api/signing/requests/${id}/file?which=source`}>Original</a>
        {open && <button type="button" className={btn} onClick={() => setVoiding(true)}>Void</button>}
      </div>
      {voiding && (
        <div className="mt-3 rounded-lg border-2 border-gray-300 p-3">
          <label htmlFor={`v-${id}`} className="block font-semibold">Why are you voiding this?</label>
          <textarea id={`v-${id}`} rows={2} className="mt-1 w-full rounded-lg border-2 border-gray-400 p-2 text-base text-black" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-2 flex gap-2"><button type="button" className={`${btn} bg-gray-900 text-white`} disabled={reason.trim().length < 3 || !!busy} onClick={() => act('void', { reason }, 'Voided')}>Void it</button><button type="button" className={btn} onClick={() => setVoiding(false)}>Cancel</button></div>
        </div>
      )}
      <details className="mt-3"><summary className="min-h-[44px] cursor-pointer py-2 font-semibold">History</summary><ul className="space-y-1">{d.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString()} — {e.event.replace(/_/g, ' ')}{e.actor ? ` (${e.actor})` : ''}</li>)}</ul></details>
    </div>
  )
}

function BulkDialog({ template, onClose, onDone }: { template: Template; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Array<{ row: number; name: string; email: string; ok: boolean; error?: string }> | null>(null)
  const parse = () => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [name, email] = l.split(/[,\t;]/).map((x) => x.trim()); return { name: name ?? '', email: email ?? '' } })
  async function send() {
    setBusy(true)
    const res = await fetch(`/api/signing/templates/${template.id}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients: parse() }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return toast.error(d.error || 'Could not send')
    setResults(d.results)
    toast.success(`${d.sent} sent`)
  }
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="bk" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 text-[#2c2c2a] sm:max-w-lg sm:rounded-2xl">
        <h2 id="bk" className="text-lg font-semibold">Send “{template.name}” to many people</h2>
        {!results ? (
          <>
            <p className="mt-1 text-base">One person per line: name, email. Each gets their own link.</p>
            <textarea aria-label="Recipients" rows={8} className="mt-2 w-full rounded-lg border-2 border-gray-400 p-2 text-base text-black" placeholder={'Pat Smith, pat@example.com\nLee Jones, lee@example.com'} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-base">{parse().length} people</p>
            <div className="mt-3 flex gap-2"><button type="button" className="min-h-[52px] flex-1 rounded-lg bg-gray-900 text-lg font-semibold text-white disabled:opacity-50" disabled={busy || parse().length === 0} onClick={send}>{busy ? 'Sending…' : 'Send'}</button><button type="button" className={btn} onClick={onClose}>Cancel</button></div>
          </>
        ) : (
          <>
            <ul className="mt-2 space-y-1 text-base">{results.map((r) => <li key={r.row}>{r.ok ? 'Sent' : 'Not sent'}: {r.name || r.email}{r.error ? ` — ${r.error}` : ''}</li>)}</ul>
            <button type="button" className="mt-3 min-h-[52px] w-full rounded-lg bg-gray-900 text-lg font-semibold text-white" onClick={onDone}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}
