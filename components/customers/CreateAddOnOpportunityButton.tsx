'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Dialog, DialogContent, DialogFooter } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { propertyDisplayName, type Property } from '@/lib/properties'

interface Props {
  customerId: string
}

export default function CreateAddOnOpportunityButton({ customerId }: Props) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Property picker: shown only when the customer has 2+ active properties (lib/properties.ts). With 0 or 1 the flow is
  // the old confirm, and the server takes the address from the customer's latest deal as before.
  const [choices, setChoices] = useState<Property[] | null>(null)
  const [picked, setPicked] = useState<string>('')

  const start = async () => {
    setError(null)
    const res = await fetch(`/api/customers/${customerId}/properties`, { cache: 'no-store' }).catch(() => null)
    const data = (res && res.ok ? await res.json().catch(() => ({})) : {}) as { ready?: boolean; properties?: Property[] }
    const active = data.ready && Array.isArray(data.properties) ? data.properties.filter((p) => p.active) : []
    if (active.length >= 2) {
      setPicked(active[0].id)
      setChoices(active)
      return
    }
    const ok = await confirmDialog({
      title: 'New add-on opportunity?',
      description: 'This keeps the original completed project separate.',
      confirmLabel: 'Create opportunity',
    })
    if (ok) await createAddOnOpportunity(null)
  }

  const createAddOnOpportunity = async (propertyId: string | null) => {
    setCreating(true)
    setError(null)

    try {
      const response = await fetch(`/api/customers/${customerId}/add-on-opportunity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(propertyId ? { body: JSON.stringify({ propertyId }) } : {}),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create add-on opportunity')
      }

      if (data.opportunity_id) {
        router.push(`/opportunities/${data.opportunity_id}`)
        return
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create add-on opportunity')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void start()}
        disabled={creating}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {creating ? 'Creating...' : 'New Add-On Opportunity'}
      </button>
      {error && <p className="max-w-xs text-right text-sm text-danger">{error}</p>}
      {choices ? (
        <Dialog open onOpenChange={(open) => !open && !creating && setChoices(null)}>
          <DialogContent title="Which property?" description="The new opportunity uses this property's address. The original project stays separate.">
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Property</legend>
              {choices.map((p) => (
                <label key={p.id} className="flex min-h-tap cursor-pointer items-center gap-3 rounded-ui border border-surface-line px-3 py-2 text-ui-base text-ink has-[:checked]:border-brand-700">
                  <input type="radio" name="addon-property" value={p.id} checked={picked === p.id} onChange={() => setPicked(p.id)} className="h-5 w-5 shrink-0" />
                  <span className="break-words">{propertyDisplayName(p)}</span>
                </label>
              ))}
            </fieldset>
            {error ? <p role="alert" className="text-ui-base text-danger">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={creating} onClick={() => setChoices(null)}>
                Cancel
              </Button>
              <Button type="button" loading={creating} disabled={!picked} onClick={() => void createAddOnOpportunity(picked)}>
                Create opportunity
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
