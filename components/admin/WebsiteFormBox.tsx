'use client'

import { useMemo, useState } from 'react'

import { Button, toast } from '@/components/ui'
import { clientLinkBase } from '@/lib/app-url'
import { buildLeadFormSnippet } from '@/lib/lead-form-snippet'
import { DEFAULT_FORM_DAILY_CAP_LABEL } from '@/lib/lead-intake'

export type WebsiteFormSource = {
  id: string
  name: string
  webhook_token: string
  default_campaign_id: string | null
  auto_assign_user_id: string | null
  public_form?: boolean | null
  form_daily_cap?: number | null
}

/**
 * Admin → Campaigns, on each lead source: "Website form". A small form the company pastes into its own website; it posts to
 * this source's webhook, so the lead lands here with the right source, campaign, owner and service.
 *
 * The code carries this source's token in a public web page, so the source is marked a public website form (honeypot,
 * required fields and a database rate limit are then always enforced) and should not also be used by a Zapier or
 * website-server integration. "Make a new source" creates one just for the form.
 */
export default function WebsiteFormBox({ source, services, onChanged }: { source: WebsiteFormSource; services: readonly string[]; onChanged: () => void }) {
  const idKey = source.id.replace(/[^a-z0-9]/gi, '').slice(0, 8)
  const snippet = useMemo(() => buildLeadFormSnippet({ endpoint: clientLinkBase(), token: source.webhook_token, services, idKey }), [source.webhook_token, services, idKey])
  const [busy, setBusy] = useState(false)
  const [cap, setCap] = useState(source.form_daily_cap ? String(source.form_daily_cap) : '')
  const isPublic = source.public_form === true

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch('/api/lead-sources', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: source.id, ...body }) })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Could not save. Please try again.')
      return false
    }
    onChanged()
    return true
  }

  const copy = async () => {
    setBusy(true)
    try {
      if (!isPublic && !(await patch({ public_form: true }))) return
      await navigator.clipboard.writeText(snippet).then(() => toast.success('Form code copied'), () => toast.error('Could not copy. Select the code and copy it.'))
    } finally {
      setBusy(false)
    }
  }

  const makeNew = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/lead-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${source.name} (website form)`,
          source_type: 'website',
          default_campaign_id: source.default_campaign_id,
          auto_assign_user_id: source.auto_assign_user_id,
          service_options: services,
          public_form: true,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(j.error || 'Could not create the source.')
      toast.success('New source created. Open its Website form box to copy the code.')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="mt-4 rounded-lg bg-gray-50 p-3">
      <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-gray-900">Website form{isPublic ? ' (on)' : ''}</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-gray-900">
          Paste this into a page on your website. People fill it in and the lead shows up here.
          {services.length ? ` The Service list has: ${services.join(', ')}.` : ' To add a Service list, edit this lead source and add the services.'}
        </p>
        <p role="note" className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-gray-900">
          This code puts this source&apos;s token on a public web page, so anyone can see it. Use a source made only for the website form, not one that Zapier or your website&apos;s server also uses.
        </p>
        <Button variant="secondary" className="min-h-[44px] self-start" disabled={busy} onClick={() => void makeNew()}>
          Make a new source for the website form
        </Button>
        <textarea readOnly rows={8} value={snippet} aria-label="Website form code" className="w-full rounded border bg-white p-2 font-mono text-sm text-gray-900" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" className="min-h-[44px] self-start" disabled={busy} onClick={() => void copy()}>
          Copy form code
        </Button>
        {isPublic && (
          <div className="flex flex-col gap-2 text-sm text-gray-900">
            <p>Spam protection is on for this source: the hidden trap field, a name and phone or email, 5 posts per visitor per 10 minutes, and a limit per day.</p>
            <label className="flex flex-wrap items-center gap-2">
              Most leads per day
              <input
                inputMode="numeric"
                value={cap}
                onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))}
                placeholder={DEFAULT_FORM_DAILY_CAP_LABEL}
                className="min-h-[44px] w-28 rounded border border-gray-300 px-3 text-base text-gray-900"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-[44px]" disabled={busy || cap === (source.form_daily_cap ? String(source.form_daily_cap) : '')} onClick={() => { setBusy(true); void patch({ form_daily_cap: cap === '' ? null : Number(cap) }).finally(() => setBusy(false)) }}>
                Save limit
              </Button>
              <Button variant="secondary" className="min-h-[44px]" disabled={busy} onClick={() => { setBusy(true); void patch({ public_form: false }).finally(() => setBusy(false)) }}>
                Turn off public form
              </Button>
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
