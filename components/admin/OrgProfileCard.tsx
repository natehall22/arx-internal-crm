'use client'

import { useRef, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Field, Select, toast } from '@/components/ui'
import { TERM_LABELS, type IndustryProfileId } from '@/lib/industry-profiles'
import type { ProfileSwitchPlan } from '@/lib/org-profile-server'

export type OrgProfileCardProps = {
  /** `unknownStoredId`: a stored profile this build doesn't know — the company runs on `label` (roofing) defaults. */
  current: { id: IndustryProfileId; label: string; description: string; unknownStoredId?: string | null }
  profiles: Array<{ id: IndustryProfileId; label: string; description: string }>
}

/**
 * Settings → Industry profile (owners only — the Settings page renders it for super admins and the API refuses anyone
 * else). Pick a profile, see exactly what changes (GET /api/admin/industry-profile?to=…), then apply. Nothing is deleted.
 */
export default function OrgProfileCard({ current, profiles }: OrgProfileCardProps) {
  const [to, setTo] = useState<IndustryProfileId | ''>('')
  const [resetFeatures, setResetFeatures] = useState(false)
  const [plan, setPlan] = useState<ProfileSwitchPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  /** Only the newest preview request may set the plan (a slow earlier answer is dropped and its fetch aborted). */
  const latest = useRef<{ id: number; abort: AbortController | null }>({ id: 0, abort: null })

  async function preview(next: IndustryProfileId | '', reset: boolean) {
    const id = ++latest.current.id
    latest.current.abort?.abort()
    const abort = new AbortController()
    latest.current.abort = abort
    setTo(next)
    setResetFeatures(reset)
    setPlan(null)
    if (!next) return setLoading(false)
    setLoading(true)
    const res = await fetch(`/api/admin/industry-profile?to=${encodeURIComponent(next)}${reset ? '&resetFeatures=1' : ''}`, { cache: 'no-store', signal: abort.signal }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (id !== latest.current.id) return // a newer choice was made meanwhile
    setLoading(false)
    if (!res || !res.ok) return toast.error((data as { error?: string }).error || 'Could not load what would change')
    const got = (data as { plan?: ProfileSwitchPlan }).plan
    // Belt and braces: only a plan for exactly what is on screen.
    if (!got || got.to.id !== next || got.resetFeatures !== reset) return toast.error('Could not load what would change')
    setPlan(got)
  }

  async function apply() {
    // Apply exactly what the shown plan was built for — never a selection that changed after it loaded.
    if (!plan) return
    setApplying(true)
    const res = await fetch('/api/admin/industry-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: plan.to.id, resetFeatures: plan.resetFeatures }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) {
      setApplying(false)
      return toast.error((data as { error?: string }).error || 'Could not switch')
    }
    toast.success(`Switched to ${plan?.to.label ?? 'the new profile'}`)
    // Menu, words and switches are read on every page load: reload so everything shows the new profile.
    window.location.reload()
  }

  const onOff = (on: boolean) => (on ? 'On' : 'Off')

  return (
    <Card id="industry-profile" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Industry profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-ui-base text-ink">
          Now: <span className="font-semibold">{current.label}</span> — {current.description}
        </p>
        {current.unknownStoredId && (
          <p className="text-ui-base font-semibold text-danger" role="status">
            Your company has a profile this version doesn’t know (“{current.unknownStoredId}”), so it runs on {current.label} defaults. Pick a profile below.
          </p>
        )}
        <p className="text-ui-sm text-ink">
          A profile sets the starting point: which features are on, your trades, the words on screens, the menu, Today and the price book. Anything you set yourself stays. Nothing is deleted.
        </p>
        <Field label="Switch to">
          {(p) => (
            <Select {...p} value={to} onChange={(e) => void preview(e.target.value as IndustryProfileId | '', resetFeatures)} className="min-h-tap text-base">
              <option value="">Choose a profile…</option>
              {profiles.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                  {o.id === current.id && !current.unknownStoredId ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {to && (
          <label className="flex min-h-tap cursor-pointer items-center gap-3 text-ui-base text-ink">
            <input type="checkbox" className="h-5 w-5 shrink-0" checked={resetFeatures} onChange={(e) => void preview(to, e.target.checked)} />
            Use this profile’s feature switches (forget the ones you turned on or off yourself)
          </label>
        )}
        {loading && <p className="text-ui-base text-ink">Working out what changes…</p>}
        {plan && (
          <div className="flex flex-col gap-3 rounded-md border border-surface-line p-3" aria-live="polite">
            <p className="text-ui-base font-semibold text-ink">What changes with {plan.to.label}</p>
            {plan.noChange && <p className="text-ui-base text-ink">Nothing — you already have this profile.</p>}
            {plan.features.length > 0 && (
              <section>
                <h3 className="text-ui-sm font-semibold text-ink">Features</h3>
                <ul className="list-disc pl-5 text-ui-base text-ink">
                  {plan.features.map((f) => (
                    <li key={f.key}>
                      {f.label}: {f.now === f.after ? `stays ${onOff(f.now)}` : `${onOff(f.now)} → ${onOff(f.after)}`}
                      {f.keptByOwnSwitch ? ' (your own switch — kept)' : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {plan.trades === null ? (
              <p className="text-ui-base text-ink">Trades: left as they are (the trades list isn’t set up in the database yet).</p>
            ) : (
              <section>
                <h3 className="text-ui-sm font-semibold text-ink">Trades</h3>
                <ul className="list-disc pl-5 text-ui-base text-ink">
                  {plan.trades.add.length > 0 && <li>Added: {plan.trades.add.join(', ')}</li>}
                  {plan.trades.turnOn.length > 0 && <li>Turned back on: {plan.trades.turnOn.join(', ')}</li>}
                  {plan.trades.keep.length > 0 && <li>Kept as they are (turn off in Job setup if you don’t use them): {plan.trades.keep.join(', ')}</li>}
                  {plan.trades.add.length === 0 && plan.trades.turnOn.length === 0 && plan.trades.keep.length === 0 && <li>No change</li>}
                </ul>
              </section>
            )}
            {plan.words.length > 0 && (
              <section>
                <h3 className="text-ui-sm font-semibold text-ink">Words on screens</h3>
                <ul className="list-disc pl-5 text-ui-base text-ink">
                  {plan.words.map((w) => (
                    <li key={w.key}>
                      {TERM_LABELS[w.key]}: “{w.now}” → “{w.after}”
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {plan.other.length > 0 && (
              <ul className="list-disc pl-5 text-ui-base text-ink">
                {plan.other.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <Button className="min-h-tap w-full sm:w-auto" loading={applying} disabled={applying || loading || plan.noChange} onClick={() => void apply()}>
              Switch to {plan.to.label}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
