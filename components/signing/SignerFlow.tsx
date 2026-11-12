'use client'

import { useMemo, useRef, useState } from 'react'

import SignaturePad from '@/components/contracts/SignaturePad'
import ConsentBlock from '@/components/signing/ConsentBlock'
import DeclineBox from '@/components/signing/DeclineBox'
import PdfPages from '@/components/signing/PdfPages'
import { useSigningBeacon } from '@/components/signing/useSigningBeacon'
import type { ConsentDisclosure } from '@/lib/signing/consent'
import { byReadingOrder, FIELD_LABELS, missingFields, type FieldKind, type FieldValue, type PlacedField } from '@/lib/signing/requests/types'

export type SignerField = PlacedField & { mine: boolean; roleLabel: string }
type Sheet = null | { kind: 'signature' | 'initials' } | { kind: 'text'; id: string } | { kind: 'finish' }

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 4).toUpperCase()
const input = 'w-full min-h-[48px] rounded-lg border-2 border-gray-400 bg-white px-3 text-base text-black'
const big = 'min-h-[52px] w-full rounded-lg bg-gray-900 px-4 text-lg font-semibold text-white disabled:opacity-50'
const ghost = 'min-h-[48px] rounded-lg border-2 border-gray-500 bg-white px-4 text-base font-semibold text-[#2c2c2a]'

/**
 * The signer's screen: read the document, tap "Start", the page jumps to each field in turn ("Next"), a signature or initials
 * is made ONCE and reused on every field of that kind, then "Finish". No account, no app. Everything is checked again on the server.
 */
export default function SignerFlow({
  token, title, companyName, signerName, roleLabel, fields, consent, declineEnabled, alreadySigned, completed, waitingFor,
}: {
  token: string; title: string; companyName: string; signerName: string; roleLabel: string; fields: SignerField[]
  consent: ConsentDisclosure | null; declineEnabled: boolean; alreadySigned: boolean; completed: boolean; waitingFor: string | null
}) {
  useSigningBeacon('signature-request', token)
  const [started, setStarted] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [initials, setInitials] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, FieldValue>>({})
  const [printName, setPrintName] = useState(signerName)
  const [agreed, setAgreed] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [done, setDone] = useState<null | 'signed' | 'completed'>(alreadySigned ? (completed ? 'completed' : 'signed') : null)
  const [declined, setDeclined] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const mine = useMemo(() => byReadingOrder(fields.filter((f) => f.mine)), [fields])
  const today = new Date().toLocaleDateString('en-US')
  const filled = (f: SignerField) => (f.kind === 'signature' ? !!signature : f.kind === 'initials' ? !!initials : f.kind === 'date' || f.kind === 'name' ? true : f.kind === 'checkbox' ? values[f.id] === true : !!String(values[f.id] ?? '').trim())
  const todo = mine.filter((f) => f.required && !filled(f))
  const required = mine.filter((f) => f.required)
  const doneCount = required.length - todo.length
  const missing = missingFields(mine, mine[0]?.roleKey ?? '', values, { signature: !!signature, initials: !!initials })

  function jump(f: SignerField | undefined) {
    if (!f) return
    setCurrent(f.id)
    const el = wrap.current?.querySelector(`[data-sf="${f.id}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  function open(f: SignerField) {
    setCurrent(f.id)
    if (f.kind === 'signature' || f.kind === 'initials') {
      if ((f.kind === 'signature' && signature) || (f.kind === 'initials' && initials)) return
      setSheet({ kind: f.kind })
    } else if (f.kind === 'text') setSheet({ kind: 'text', id: f.id })
    else if (f.kind === 'checkbox') { setValues((v) => ({ ...v, [f.id]: v[f.id] !== true })); }
  }
  function next() {
    const f = todo.find((x) => x.id !== current) ?? todo[0]
    if (!f) { if (consent || true) setSheet({ kind: 'finish' }); return }
    jump(f)
    open(f)
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/signing/requests/sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signature, initials, printName, values, ...(consent ? { consent: { accepted: agreed, version: consent.version } } : {}) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save your signature')
      setSheet(null)
      setDone(d.state === 'completed' ? 'completed' : 'signed')
      window.scrollTo?.({ top: 0 })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your signature')
    } finally {
      setBusy(false)
    }
  }

  if (declined) return <Card><h1 className="text-xl font-bold">Thank you for letting us know</h1><p className="mt-2 text-base">We have told {companyName}. Nothing was signed.</p></Card>
  if (done) {
    return (
      <Card>
        <h1 className="text-2xl font-bold">{done === 'completed' ? 'All signed. Thank you!' : 'You have signed. Thank you!'}</h1>
        <p className="mt-2 text-base">{done === 'completed' ? `${companyName} has the signed copy. You can keep one too.` : `We will email you the signed copy when everyone has signed.`}</p>
        {done === 'completed' && (
          <div className="mt-4 space-y-2">
            <a className={`${big} flex items-center justify-center`} href={`/api/signing/requests/file?token=${encodeURIComponent(token)}&which=signed`}>Download your signed copy</a>
            <a className={`${ghost} flex items-center justify-center`} href={`/api/signing/requests/file?token=${encodeURIComponent(token)}&which=certificate`}>Download the certificate</a>
          </div>
        )}
      </Card>
    )
  }
  if (waitingFor) return <Card><h1 className="text-xl font-bold">Not your turn yet</h1><p className="mt-2 text-base">{waitingFor} signs first. You will get an email as soon as it is your turn.</p></Card>

  return (
    <div className="pb-32 text-[#2c2c2a]">
      <header className="sticky top-0 z-20 border-b border-gray-300 bg-white px-3 py-2">
        <p className="text-base font-bold">{companyName}</p>
        <p className="text-base">{title}</p>
        {started && <div className="mt-1" aria-live="polite"><div className="h-2 w-full rounded bg-gray-200"><div className="h-2 rounded bg-green-700" style={{ width: `${required.length ? (doneCount / required.length) * 100 : 100}%` }} /></div><p className="mt-1 text-base">{doneCount} of {required.length} done</p></div>}
      </header>

      <div ref={wrap} className="mx-auto max-w-3xl px-2 pt-3">
        {!started && <p className="mb-3 rounded-lg border-2 border-gray-300 bg-white p-3 text-base">Hi {signerName.split(' ')[0]}. Read the document below, then tap <strong>Start</strong>. You are signing as <strong>{roleLabel}</strong>.</p>}
        <PdfPages
          source={`/api/signing/requests/file?token=${encodeURIComponent(token)}&which=source`}
          renderOverlay={(page) => fields.filter((f) => f.page === page).map((f) => {
            const isMine = f.mine
            const ok = isMine && filled(f)
            return (
              <button
                key={f.id}
                type="button"
                data-sf={f.id}
                data-field={f.id}
                disabled={!isMine}
                aria-label={`${FIELD_LABELS[f.kind]}${isMine ? (ok ? ' (done)' : f.required ? ' (needed)' : ' (optional)') : ` for ${f.roleLabel}`}`}
                onClick={() => isMine && open(f)}
                className={`absolute flex items-center overflow-hidden rounded-sm border-2 px-1 text-left text-sm font-semibold leading-none text-black ${!isMine ? 'border-dashed border-gray-500 bg-gray-100/70' : ok ? 'border-green-700 bg-green-100/60' : 'border-amber-600 bg-amber-100/80'} ${current === f.id ? 'ring-4 ring-black' : ''}`}
                style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, minHeight: 24 }}
              >
                <FieldFace f={f} isMine={isMine} signature={signature} initials={initials} value={values[f.id]} printName={printName} today={today} />
              </button>
            )
          })}
        />
        {declineEnabled && <DeclineBox kind="signature-request" token={token} companyName={companyName} onDeclined={() => setDeclined(true)} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-400 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          {!started
            ? <button type="button" className={big} onClick={() => { setStarted(true); next() }}>Start</button>
            : todo.length > 0
              ? <button type="button" className={big} onClick={next}>Next: {FIELD_LABELS[(todo.find((x) => x.id !== current) ?? todo[0]).kind]}</button>
              : <button type="button" className={big} onClick={() => setSheet({ kind: 'finish' })}>Review and finish</button>}
        </div>
      </div>

      {sheet?.kind === 'signature' && <MarkSheet title="Your signature" typedLabel="Type your name" defaultText={printName} onCancel={() => setSheet(null)} onUse={(v) => { setSignature(v); setSheet(null) }} />}
      {sheet?.kind === 'initials' && <MarkSheet title="Your initials" typedLabel="Type your initials" defaultText={initialsOf(printName)} onCancel={() => setSheet(null)} onUse={(v) => { setInitials(v); setSheet(null) }} small />}
      {sheet?.kind === 'text' && <TextSheet field={fields.find((f) => f.id === (sheet as { id: string }).id) as SignerField} value={String(values[(sheet as { id: string }).id] ?? '')} onCancel={() => setSheet(null)} onSave={(v) => { setValues((x) => ({ ...x, [(sheet as { id: string }).id]: v })); setSheet(null) }} />}
      {sheet?.kind === 'finish' && (
        <BottomSheet title="Finish signing" onClose={() => setSheet(null)}>
          <label htmlFor="pn" className="block text-base font-semibold">Your full name</label>
          <input id="pn" className={input} value={printName} autoComplete="name" maxLength={120} onChange={(e) => setPrintName(e.target.value)} />
          {consent && <div className="mt-3"><ConsentBlock disclosure={consent} checked={agreed} onChange={setAgreed} /></div>}
          {missing.length > 0 && <p className="mt-2 text-base text-red-800">Some required fields are still empty.</p>}
          {error && <p role="alert" className="mt-2 text-base font-medium text-red-800">{error}</p>}
          <button type="button" className={`${big} mt-3`} disabled={busy || missing.length > 0 || !printName.trim() || (!!consent && !agreed)} onClick={finish}>{busy ? 'Saving…' : 'Sign and finish'}</button>
        </BottomSheet>
      )}
    </div>
  )
}

function FieldFace({ f, isMine, signature, initials, value, printName, today }: { f: SignerField; isMine: boolean; signature: string | null; initials: string | null; value: FieldValue; printName: string; today: string }) {
  const kind: FieldKind = f.kind
  if (!isMine) return <span className="truncate">{f.roleLabel}: {FIELD_LABELS[kind].toLowerCase()}</span>
  const mark = kind === 'signature' ? signature : kind === 'initials' ? initials : null
  if (mark) {
    if (mark.startsWith('typed:')) return <span className="truncate italic" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 'clamp(12px, 3.4vw, 22px)' }}>{mark.slice(6)}</span>
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={mark} alt="" className="h-full w-full object-contain" />
  }
  if (kind === 'date') return <span>{today}</span>
  if (kind === 'name') return <span className="truncate">{printName}</span>
  if (kind === 'checkbox') return <span aria-hidden className="mx-auto text-lg">{value === true ? '✔' : ''}</span>
  if (kind === 'text' && String(value ?? '').trim()) return <span className="truncate">{String(value)}</span>
  return <span>{kind === 'signature' ? 'Tap to sign' : kind === 'initials' ? 'Initial' : kind === 'text' ? (f.label || 'Tap to type') : FIELD_LABELS[kind]}</span>
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4"><div className="w-full max-w-md rounded-xl bg-white p-6 text-center text-[#2c2c2a] shadow-lg">{children}</div></div>
}

function BottomSheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[#2c2c2a] sm:max-w-lg sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button type="button" className="min-h-[44px] px-3 text-base font-medium underline" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  )
}

/** Type or draw, once. Typing is the default (fastest on a phone); the result is reused on every field of this kind. */
function MarkSheet({ title, typedLabel, defaultText, onCancel, onUse, small }: { title: string; typedLabel: string; defaultText: string; onCancel: () => void; onUse: (v: string) => void; small?: boolean }) {
  const [tab, setTab] = useState<'type' | 'draw'>('type')
  const [text, setText] = useState(defaultText)
  const [drawn, setDrawn] = useState<string | null>(null)
  return (
    <BottomSheet title={title} onClose={onCancel}>
      <div className="mb-3 flex gap-2" role="tablist">
        {(['type', 'draw'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`min-h-[48px] flex-1 rounded-lg border-2 text-base font-semibold ${tab === t ? 'border-black bg-gray-900 text-white' : 'border-gray-400 bg-white'}`}>{t === 'type' ? 'Type' : 'Draw'}</button>)}
      </div>
      {tab === 'type' ? (
        <>
          <label htmlFor="mk" className="block text-base font-semibold">{typedLabel}</label>
          <input id="mk" className={input} value={text} maxLength={small ? 8 : 120} onChange={(e) => setText(e.target.value)} />
          <p className="mt-2 rounded-lg border-2 border-gray-300 p-3 text-center italic" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 28 }}>{text || ' '}</p>
        </>
      ) : (
        <SignaturePad onChange={setDrawn} value={drawn} width={340} height={small ? 110 : 150} />
      )}
      <p className="mt-2 text-base">I understand this counts as my legal {small ? 'initials' : 'signature'} on this document.</p>
      <button type="button" className={`${big} mt-3`} disabled={tab === 'type' ? !text.trim() : !drawn} onClick={() => onUse(tab === 'type' ? `typed:${text.trim()}` : (drawn as string))}>Use this</button>
    </BottomSheet>
  )
}

function TextSheet({ field, value, onCancel, onSave }: { field: SignerField; value: string; onCancel: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  return (
    <BottomSheet title={field.label || 'Type your answer'} onClose={onCancel}>
      <input className={input} autoFocus value={v} maxLength={500} onChange={(e) => setV(e.target.value)} aria-label={field.label || 'Your answer'} />
      <button type="button" className={`${big} mt-3`} disabled={field.required && !v.trim()} onClick={() => onSave(v.trim())}>Save</button>
    </BottomSheet>
  )
}
