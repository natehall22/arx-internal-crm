'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { ORG_FEATURE_DEFS, ORG_FEATURE_KEYS, type OrgFeature, type OrgFeatures } from '@/lib/org-features'

/**
 * Settings → Features card (owners only — the Settings page renders it for super admins, and the save is refused for
 * anyone else): turn whole parts of the app on or off for this company. Saved per feature through
 * PATCH /api/admin/settings `type: 'features'` (lib/org-features.ts). Nothing is deleted when a feature is off.
 */
export default function OrgFeaturesCard({ initial }: { initial: OrgFeatures }) {
  const [features, setFeatures] = useState<OrgFeatures>(initial)
  const [saving, setSaving] = useState<OrgFeature | null>(null)

  async function toggle(key: OrgFeature) {
    const next = !features[key]
    setSaving(key)
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'features', features: { [key]: next } }),
    }).catch(() => null)
    setSaving(null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return toast.error((data as { error?: string }).error || 'Could not save')
    setFeatures((f) => ({ ...f, [key]: next }))
    toast.success(`${ORG_FEATURE_DEFS[key].label} turned ${next ? 'on' : 'off'}`)
  }

  return (
    <Card id="features" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Features</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-ui-base text-ink">
          Turn off what your company doesn’t use. It disappears for everyone; nothing is deleted, and turning it back on brings it all back.
        </p>
        <ul className="divide-y divide-surface-line">
          {ORG_FEATURE_KEYS.map((key) => {
            const on = features[key]
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-ui-base font-semibold text-ink">
                    {ORG_FEATURE_DEFS[key].label} <span className={on ? 'text-brand-700' : 'text-danger'}>· {on ? 'On' : 'Off'}</span>
                  </p>
                  <p className="text-ui-sm text-ink">{ORG_FEATURE_DEFS[key].description}</p>
                </div>
                <Button
                  variant={on ? 'secondary' : 'primary'}
                  className="min-h-tap min-w-[7rem]"
                  loading={saving === key}
                  disabled={saving !== null && saving !== key}
                  aria-pressed={on}
                  aria-label={`${on ? 'Turn off' : 'Turn on'} ${ORG_FEATURE_DEFS[key].label}`}
                  onClick={() => void toggle(key)}
                >
                  {on ? 'Turn off' : 'Turn on'}
                </Button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
