'use client'

import { useEffect, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import type { SigningSettings } from '@/lib/signing/settings'

/**
 * Settings → Signing (owners): the e-sign notice customers agree to, the "I can't sign this" button, filing signed copies on the
 * customer, automatic reminders (default day 2 and day 5), and the signed-copy emails. Route /api/admin/signing; rules lib/signing/settings.ts.
 */
function Row({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
      <span className="text-base text-[#2c2c2a]">
        <span className="font-medium">{label}</span>
        <span className="block text-sm text-[#4b5563]">{hint}</span>
      </span>
    </label>
  )
}

export default function SigningSettingsCard() {
  const [s, setS] = useState<SigningSettings | null>(null)
  const [days, setDays] = useState('2, 5')
  const [busy, setBusy] = useState(false)

  function fill(v: SigningSettings) {
    setS(v)
    setDays(v.reminders.days.join(', '))
  }

  useEffect(() => {
    void fetch('/api/admin/signing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: SigningSettings } | null) => d?.settings && fill(d.settings))
      .catch(() => null)
  }, [])

  async function save() {
    if (!s) return
    const parsedDays = days.split(/[,\s]+/).filter(Boolean).map(Number)
    setBusy(true)
    const res = await fetch('/api/admin/signing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          consentStep: s.consentStep,
          declineEnabled: s.declineEnabled,
          autoFile: s.autoFile,
          extendDays: s.extendDays,
          reminders: { enabled: s.reminders.enabled, days: parsedDays },
          emails: s.emails,
        },
      }),
    }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { settings?: SigningSettings; error?: string }) : null
    setBusy(false)
    if (!res?.ok || !data?.settings) return toast.error(data?.error || 'Could not save')
    fill(data.settings)
    toast.success('Saved')
  }

  if (!s) return null
  return (
    <Card id="signing" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Signing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Row label="Ask customers to agree to sign electronically" hint="A short notice and one tick box before they sign. Recommended before anyone outside your own team signs." checked={s.consentStep} onChange={(v) => setS({ ...s, consentStep: v })} />
        <Row label="Let customers say “I can’t sign this”" hint="They give a reason; the document is voided (kept) and your note shows why." checked={s.declineEnabled} onChange={(v) => setS({ ...s, declineEnabled: v })} />
        <Row label="File signed copies on the customer" hint="The signed PDF and its certificate appear under the customer’s documents, protected." checked={s.autoFile} onChange={(v) => setS({ ...s, autoFile: v })} />
        <Row label="Remind customers who haven’t signed" hint="One email each on the days below, daytime only." checked={s.reminders.enabled} onChange={(v) => setS({ ...s, reminders: { ...s.reminders, enabled: v } })} />
        <label className="flex flex-col gap-1 pl-9">
          <span className="text-sm text-[#4b5563]">Days after sending (up to 4, e.g. 2, 5)</span>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="min-h-[44px] w-48 rounded-lg border border-gray-400 px-3 text-base text-black" />
        </label>
        <Row label="Email the signed copy and certificate" hint="The customer’s copy carries the signed PDF and certificate; you and the company inbox get a copy too." checked={s.emails.signedCopy} onChange={(v) => setS({ ...s, emails: { ...s.emails, signedCopy: v } })} />
        <Row label="Tell me when a customer declines" hint="An email to the rep and the company inbox." checked={s.emails.declineNotice} onChange={(v) => setS({ ...s, emails: { ...s.emails, declineNotice: v } })} />
        <div className="pt-2">
          <Button onClick={save} disabled={busy} className="min-h-[48px]">{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
