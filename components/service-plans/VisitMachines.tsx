'use client'

import * as React from 'react'

import MachinePicker, { type MachineOption } from '@/components/service-plans/MachinePicker'
import { Button, Dialog, DialogContent, DialogFooter, toast } from '@/components/ui'

type View = { own: string[] | null; plan: string[] | null; names: Record<string, string>; machines: MachineOption[] }

/**
 * Visits board → a visit's "More": the machines for THIS visit. Off = it uses the plan's machines; on = its own list (which can be
 * empty). Reads / writes /api/ops/visits/<id>/equipment.
 */
export default function VisitMachines({ visitId, onSaved }: { visitId: string; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<View | null>(null)
  const [own, setOwn] = React.useState(false)
  const [ids, setIds] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let live = true
    setView(null)
    fetch(`/api/ops/visits/${visitId}/equipment`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: View | null) => {
        if (!live) return
        if (!v) {
          toast.error('Could not load the machines')
          return setOpen(false)
        }
        setView(v)
        setOwn(v.own !== null)
        setIds(v.own ?? v.plan ?? [])
      })
      .catch(() => live && setOpen(false))
    return () => {
      live = false
    }
  }, [open, visitId])

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/ops/visits/${visitId}/equipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipment_item_ids: own ? ids : null }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setSaving(false)
    if (!res || !res.ok) return toast.error(out.error || 'Could not save the machines')
    toast.success('Machines saved')
    setOpen(false)
    onSaved()
  }

  const planNames = view ? (view.plan ?? []).map((id) => view.names[id] ?? 'Machine') : []
  return (
    <>
      <Button size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>Machines</Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setOpen(false)}>
          <DialogContent title="Machines for this visit">
            {!view ? (
              <p className="text-ui-base text-ink">Loading…</p>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save()
                }}
              >
                <label className="flex min-h-tap items-center gap-3 text-ui-base font-semibold text-ink">
                  <input type="checkbox" className="h-6 w-6" checked={own} onChange={(e) => setOwn(e.target.checked)} />
                  Different machines for this visit
                </label>
                {own ? (
                  <MachinePicker options={view.machines} value={ids} onChange={setIds} disabled={saving} />
                ) : (
                  <p className="break-words text-ui-base text-ink">Uses the plan’s machines: {planNames.length ? planNames.join(', ') : 'none set'}.</p>
                )}
                <DialogFooter>
                  <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" loading={saving}>Save</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
