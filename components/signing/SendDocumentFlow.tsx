'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import FieldEditor from '@/components/signing/FieldEditor'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { toast } from '@/components/ui/toast'
import { LIMITS, type PlacedField, type RoleDef, type SigningOrder } from '@/lib/signing/requests/types'

type Row = { key: string; label: string; name: string; email: string }
type TemplateLite = { id: string; name: string; page_count: number; roles: RoleDef[] }
type Prefill = { templateId?: string; customerId?: string; opportunityId?: string; jobId?: string; name?: string; email?: string }

const input = 'w-full min-h-[48px] rounded-lg border-2 border-gray-400 bg-white px-3 text-base text-black'
const btn = 'min-h-[48px] rounded-lg border-2 border-gray-500 bg-white px-4 text-base font-semibold text-[#2c2c2a]'
const primary = 'min-h-[52px] w-full rounded-lg bg-gray-900 px-4 text-lg font-semibold text-white disabled:opacity-50'

/**
 * Send a document for signature, or save a template. Three taps from a template: pick it, fill the name and email, Send.
 * From a new PDF: drop it, say who signs, tap the page to place their fields, Send.
 */
export default function SendDocumentFlow({ mode = 'send', prefill = {} }: { mode?: 'send' | 'template'; prefill?: Prefill }) {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [template, setTemplate] = useState<TemplateLite | null>(null)
  const [templateFields, setTemplateFields] = useState<PlacedField[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [title, setTitle] = useState('')
  const [rows, setRows] = useState<Row[]>([{ key: 'customer', label: mode === 'template' ? 'Signer' : 'Customer', name: prefill.name ?? '', email: prefill.email ?? '' }])
  const [order, setOrder] = useState<SigningOrder>('parallel')
  const [message, setMessage] = useState('')
  const [days, setDays] = useState(14)
  const [fields, setFields] = useState<PlacedField[]>([])
  const [placing, setPlacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    if (mode !== 'send') return
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetch('/api/signing/templates', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => { setTemplates(d?.templates ?? []); setCanManage(!!d?.canManage); const t = (d?.templates ?? []).find((x: TemplateLite) => x.id === prefill.templateId); if (t) void pickTemplate(t) }).catch(() => setTemplates([]))
  }, [mode])

  // Keys are stable (set when a signer is added), so renaming a signer never detaches the fields placed for them.
  const roles: RoleDef[] = useMemo(() => (template ? template.roles : rows.map((r, i) => ({ key: r.key, label: r.label.trim() || `Signer ${i + 1}`, order: i }))), [rows, template])
  const nextKey = () => { let n = rows.length + 1; while (rows.some((r) => r.key === `signer_${n}`)) n++; return `signer_${n}` }

  async function choose(f: File | undefined) {
    if (!f) return
    setError(null)
    if (f.type && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return setError('Choose a PDF file')
    if (f.size > LIMITS.maxPdfBytes) return setError(`That PDF is larger than ${Math.round(LIMITS.maxPdfBytes / 1048576)} MB`)
    setFile(f)
    setBytes(await f.arrayBuffer())
    setTitle((t) => t || f.name.replace(/\.pdf$/i, ''))
    setFields([])
  }

  async function pickTemplate(t: TemplateLite) {
    const res = await fetch(`/api/signing/templates/${t.id}`, { cache: 'no-store' })
    const d = res.ok ? await res.json() : null
    if (!d) return toast.error('Could not open that template')
    setTemplate(t)
    setTemplateFields(d.fields)
    setTitle(t.name)
    setRows(t.roles.map((r, i) => ({ key: r.key, label: r.label, name: i === 0 ? prefill.name ?? '' : '', email: i === 0 ? prefill.email ?? '' : '' })))
  }

  const sendable = mode === 'template'
    ? !!file && fields.length > 0 && title.trim().length > 0
    : (template ? true : !!file && fields.length > 0) && title.trim().length > 0 && rows.every((r) => r.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      if (mode === 'template') {
        form.set('payload', JSON.stringify({ name: title.trim(), roles, fields }))
        if (file) form.set('file', file)
        const res = await fetch('/api/signing/templates', { method: 'POST', body: form })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || 'Could not save the template')
        toast.success('Template saved')
        router.push('/signing')
        return
      }
      const signers = roles.map((r, i) => ({ roleKey: r.key, name: rows[i].name.trim(), email: rows[i].email.trim() }))
      form.set('payload', JSON.stringify({ title: title.trim(), templateId: template?.id, roles, fields: template ? templateFields : fields, signers, signingOrder: order, message: message.trim() || undefined, expiresInDays: days, customerId: prefill.customerId, opportunityId: prefill.opportunityId, jobId: prefill.jobId }))
      if (!template && file) form.set('file', file)
      const res = await fetch('/api/signing/requests', { method: 'POST', body: form })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not send')
      toast.success(d.failed?.length ? `Created, but we could not email ${d.failed.join(', ')}. Use the list to send it again.` : 'Sent for signature')
      router.push('/signing')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  if (placing && bytes) {
    return (
      <div className="pb-28">
        <FieldEditor source={bytes} roles={roles} fields={fields} onChange={setFields} onLoaded={(p) => setPageCount(p.length)} />
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-400 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" className={primary} onClick={() => setPlacing(false)}>Done placing ({fields.length}){pageCount ? ` · ${pageCount} pages` : ''}</button>
        </div>
      </div>
    )
  }

  const showTemplates = mode === 'send' && !file && !template
  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-32 text-[#2c2c2a]">
      {showTemplates && templates && templates.length > 0 && (
        <section aria-labelledby="tpl">
          <h2 id="tpl" className="mb-2 text-lg font-semibold">Send a saved template</h2>
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}><button type="button" className={`${btn} flex w-full items-center justify-between text-left`} onClick={() => pickTemplate(t)}><span>{t.name}</span><span className="text-base font-normal">{t.roles.length} signer{t.roles.length > 1 ? 's' : ''}</span></button></li>
            ))}
          </ul>
          <p className="my-3 text-center text-base">or</p>
        </section>
      )}

      {!template && (
        <section aria-labelledby="doc">
          <h2 id="doc" className="mb-2 text-lg font-semibold">{mode === 'template' ? 'The document' : 'Send your own PDF'}</h2>
          <FileDropZone accept="application/pdf,.pdf" multiple={false} label={file ? `${file.name} (tap to change)` : 'Drop a PDF here or tap to choose'} hint={`PDF up to ${Math.round(LIMITS.maxPdfBytes / 1048576)} MB`} onFiles={(f) => void choose(f[0])} />
        </section>
      )}

      {(file || template) && (
        <>
          <section aria-labelledby="ttl">
            <label id="ttl" htmlFor="title" className="mb-1 block text-base font-semibold">{mode === 'template' ? 'Template name' : 'Document title'}</label>
            <input id="title" className={input} value={title} maxLength={LIMITS.maxTitle} onChange={(e) => setTitle(e.target.value)} />
          </section>

          <section aria-labelledby="who">
            <h2 id="who" className="mb-2 text-lg font-semibold">Who signs</h2>
            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="rounded-lg border-2 border-gray-300 bg-white p-3">
                  {!template && (
                    <div className="mb-2 flex gap-2">
                      <input aria-label={`Signer ${i + 1} role`} className={input} value={r.label} maxLength={40} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                      {rows.length > 1 && <button type="button" className={btn} aria-label={`Remove signer ${i + 1}`} onClick={() => { setFields(fields.filter((f) => f.roleKey !== r.key)); setRows(rows.filter((_, j) => j !== i)) }}>Remove</button>}
                    </div>
                  )}
                  {template && <p className="mb-2 text-base font-semibold">{r.label}</p>}
                  {mode === 'send' && (
                    <div className="space-y-2">
                      <input aria-label={`${r.label} name`} className={input} placeholder="Full name" autoComplete="name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <input aria-label={`${r.label} email`} className={input} placeholder="Email" type="email" inputMode="email" autoComplete="email" value={r.email} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!template && rows.length < LIMITS.maxRoles && (
              <button type="button" className={`${btn} mt-2`} onClick={() => setRows([...rows, { key: nextKey(), label: `Signer ${rows.length + 1}`, name: '', email: '' }])}>+ Add a signer</button>
            )}
            {mode === 'send' && rows.length > 1 && (
              <fieldset className="mt-3">
                <legend className="mb-1 text-base font-semibold">Who signs first?</legend>
                {(['parallel', 'serial'] as const).map((o) => (
                  <label key={o} className="flex min-h-[44px] items-center gap-3 text-base"><input type="radio" name="order" className="h-6 w-6" checked={order === o} onChange={() => setOrder(o)} />{o === 'parallel' ? 'Everyone at once' : 'One after another, in this order'}</label>
                ))}
              </fieldset>
            )}
          </section>

          {!template && (
            <section aria-labelledby="fld">
              <h2 id="fld" className="mb-2 text-lg font-semibold">Fields</h2>
              <button type="button" className={`${btn} w-full`} onClick={() => setPlacing(true)}>{fields.length ? `Edit the ${fields.length} fields` : 'Place signature fields on the document'}</button>
              {fields.length === 0 && <p className="mt-1 text-base">Every signer needs at least a signature field.</p>}
            </section>
          )}

          {mode === 'send' && (
            <details className="rounded-lg border-2 border-gray-300 bg-white p-3">
              <summary className="min-h-[44px] cursor-pointer py-2 text-base font-semibold">More options</summary>
              <label htmlFor="msg" className="mt-2 block text-base font-semibold">Message to the signer (optional)</label>
              <textarea id="msg" className={`${input} py-2`} rows={3} maxLength={LIMITS.maxMessage} value={message} onChange={(e) => setMessage(e.target.value)} />
              <label htmlFor="days" className="mt-3 block text-base font-semibold">Link works for (days)</label>
              <input id="days" type="number" inputMode="numeric" className={input} min={LIMITS.minExpiryDays} max={LIMITS.maxExpiryDays} value={days} onChange={(e) => setDays(Number(e.target.value) || LIMITS.defaultExpiryDays)} />
            </details>
          )}
        </>
      )}

      {error && <p role="alert" className="rounded-lg border-2 border-red-600 bg-white p-3 text-base font-medium text-red-800">{error}</p>}

      {(file || template) && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-400 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-2xl">
            <button type="button" className={primary} disabled={!sendable || busy} onClick={submit}>{busy ? 'Working…' : mode === 'template' ? 'Save template' : 'Send for signature'}</button>
          </div>
        </div>
      )}
      {mode === 'send' && canManage && !file && !template && <p className="text-center"><a className="text-base font-semibold underline" href="/signing/templates/new">Create a template</a></p>}
    </div>
  )
}
