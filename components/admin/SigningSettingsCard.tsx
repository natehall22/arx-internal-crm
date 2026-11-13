'use client'

import { useEffect, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { NumberChips } from '@/components/ui/number-chips'
import { BULK_DAILY_CAP_RANGE, MAX_REMINDERS, MAX_REMINDER_DAY, type SigningSettings } from '@/lib/signing/settings'
import type { ChipRules } from '@/lib/chip-numbers'

/**
 * Settings → Signing (owners): the e-sign notice customers agree to, the "I can't sign this" button, filing signed copies on the
 * customer, automatic reminders (default day 2 and day 5), and the signed-copy emails. Route /api/admin/signing; rules lib/signing/settings.ts.
 * A sub-setting only shows while the switch it belongs to is on; one Save button, enabled only when something changed.
 */
const REMINDER_RULES: ChipRules = { unit: 'day', min: 1, max: MAX_REMINDER_DAY, maxCount: MAX_REMINDERS }
const REMINDER_PRESETS = [1, 2, 3, 5, 7, 10, 14] as const

function Row({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
      <span className="text-base text-[#2c2c2a]">
        <span className="font-medium">{label}</span>
        <span className="block text-sm text-[#2c2c2a]">{hint}</span>
      </span>
    </label>
  )
}

/** The values the card edits (what Save sends), for "did anything change". */
function editable(v: SigningSettings, bulkDailyCap: number) {
  return { consentStep: v.consentStep, declineEnabled: v.declineEnabled, autoFile: v.autoFile, customDocuments: v.customDocuments, bulkDailyCap, reminders: v.reminders, emails: v.emails }
}

export default function SigningSettingsCard() {
  const [s, setS] = useState<SigningSettings | null>(null)
  const [saved, setSaved] = useState('')
  const [capText, setCapText] = useState('')
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  function fill(v: SigningSettings) {
    setS(v)
    setCapText(String(v.bulkDailyCap))
    setSaved(JSON.stringify(editable(v, v.bulkDailyCap)))
  }

  useEffect(() => {
    void fetch('/api/admin/signing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: SigningSettings } | null) => d?.settings && fill(d.settings))
      .catch(() => null)
  }, [])

  if (!s) return null

  function change(next: SigningSettings) {
    setS(next)
    setJustSaved(false)
  }

  const capNum = /^\d+$/.test(capText.trim()) ? Number(capText.trim()) : NaN
  const capOk = Number.isInteger(capNum) && capNum >= BULK_DAILY_CAP_RANGE.min && capNum <= BULK_DAILY_CAP_RANGE.max
  // A hidden or half-typed limit never blocks a save or changes what is stored.
  const cap = s.customDocuments && capOk ? capNum : s.bulkDailyCap
  const dirty = JSON.stringify(editable(s, cap)) !== saved
  const blocked = (s.customDocuments && !capOk) || (s.reminders.enabled && s.reminders.days.length === 0)
  const canSave = dirty && !blocked

  async function save() {
    if (!s) return
    setBusy(true)
    const res = await fetch('/api/admin/signing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          consentStep: s.consentStep,
          declineEnabled: s.declineEnabled,
          autoFile: s.autoFile,
          customDocuments: s.customDocuments,
          bulkDailyCap: cap,
          extendDays: s.extendDays,
          reminders: { enabled: s.reminders.enabled, days: s.reminders.days },
          emails: s.emails,
        },
      }),
    }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { settings?: SigningSettings; error?: string }) : null
    setBusy(false)
    if (!res?.ok || !data?.settings) return toast.error(data?.error || 'Could not save')
    fill(data.settings)
    setJustSaved(true)
  }

  return (
    <Card id="signing" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Signing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-[#2c2c2a]">
        <Row label="Ask customers to agree to sign electronically" hint="A short notice and one tick box before they sign. Recommended before anyone outside your own team signs." checked={s.consentStep} onChange={(v) => change({ ...s, consentStep: v })} />

        <Row label="Let customers say “I can’t sign this”" hint="They give a reason; the document is voided (kept) and your note shows why." checked={s.declineEnabled} onChange={(v) => change({ ...s, declineEnabled: v })} />
        {s.declineEnabled && (
          <div className="pl-9">
            <Row label="Tell me when a customer declines" hint="An email to the rep and the company inbox." checked={s.emails.declineNotice} onChange={(v) => change({ ...s, emails: { ...s.emails, declineNotice: v } })} />
          </div>
        )}

        <Row label="Send your own documents for signature" hint="Upload any PDF, place signature fields, save templates and send to many people at once." checked={s.customDocuments} onChange={(v) => change({ ...s, customDocuments: v })} />
        {s.customDocuments && (
          <label className="flex flex-col gap-1 pl-9">
            <span className="text-sm font-medium">Daily limit for bulk sends (people per day)</span>
            <input value={capText} onChange={(e) => { setCapText(e.target.value); setJustSaved(false) }} inputMode="numeric" aria-invalid={!capOk} className="min-h-[44px] w-48 rounded-lg border border-gray-400 px-3 text-base text-[#2c2c2a]" />
            {!capOk && <span role="alert" className="text-sm font-semibold text-danger">A whole number from {BULK_DAILY_CAP_RANGE.min} to {BULK_DAILY_CAP_RANGE.max}.</span>}
          </label>
        )}

        <Row label="File signed copies on the customer" hint="The signed PDF and its certificate appear under the customer’s documents, protected." checked={s.autoFile} onChange={(v) => change({ ...s, autoFile: v })} />

        <Row label="Remind customers who haven’t signed" hint="One email each, daytime only, on the days after sending that you pick." checked={s.reminders.enabled} onChange={(v) => change({ ...s, reminders: { ...s.reminders, enabled: v } })} />
        {s.reminders.enabled && (
          <div className="flex flex-col gap-1 pl-9">
            <span className="text-sm font-medium">Send a reminder after</span>
            <NumberChips
              values={s.reminders.days}
              onChange={(days) => change({ ...s, reminders: { ...s.reminders, days } })}
              rules={REMINDER_RULES}
              presets={REMINDER_PRESETS}
              addLabel="+ Add reminder"
              pickTitle="How many days after sending?"
              listLabel="Reminder days"
              disabled={busy}
            />
            {s.reminders.days.length === 0 && <span role="alert" className="text-sm font-semibold text-danger">Add at least one reminder, or turn reminders off.</span>}
          </div>
        )}

        <Row label="Email the signed copy and certificate" hint="The customer’s copy carries the signed PDF and certificate; you and the company inbox get a copy too." checked={s.emails.signedCopy} onChange={(v) => change({ ...s, emails: { ...s.emails, signedCopy: v } })} />

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} disabled={!canSave} loading={busy} className="min-h-tap">Save changes</Button>
          {justSaved && !dirty && <span role="status" className="text-base font-semibold">Saved</span>}
        </div>
      </CardContent>
    </Card>
  )
}
