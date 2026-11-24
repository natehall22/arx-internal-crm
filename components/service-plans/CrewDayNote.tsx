'use client'

import * as React from 'react'

import { Button, Dialog, DialogContent, DialogFooter, Field, Textarea, toast } from '@/components/ui'
import { CREW_NOTE_MAX } from '@/lib/truck-sheet'

/**
 * Visits board: "Note for the crew" for ONE crew and day. The crew sees it at the top of its phone page and on the printed sheet.
 * Reads / writes /api/ops/visits/crew-note. A blank note clears it.
 */
export default function CrewDayNote({ crewId, day, crewName }: { crewId: string; day: string; crewName: string }) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [has, setHas] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let live = true
    setLoaded(false)
    fetch(`/api/ops/visits/crew-note?crew=${encodeURIComponent(crewId)}&day=${day}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { note: null }))
      .then((d: { note: string | null }) => {
        if (!live) return
        setText(d.note ?? '')
        setHas(!!d.note)
        setLoaded(true)
      })
      .catch(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [open, crewId, day])

  async function save() {
    setSaving(true)
    const res = await fetch('/api/ops/visits/crew-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crew: crewId, day, note: text }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; note?: string | null }
    setSaving(false)
    if (!res || !res.ok) return toast.error(out.error || 'Could not save the note')
    setHas(!!out.note)
    toast.success(out.note ? 'Note saved' : 'Note cleared')
    setOpen(false)
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {has ? 'Edit note for the crew' : 'Note for the crew'}
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setOpen(false)}>
          <DialogContent title={`Note for ${crewName}`} description="Shown at the top of the crew’s phone page and on their printed sheet for this day only.">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <Field label="Note for the crew (they will see this)" hint={`${text.length} of ${CREW_NOTE_MAX}`}>
                {(a) => <Textarea {...a} className="text-base" rows={5} maxLength={CREW_NOTE_MAX} disabled={!loaded} value={text} onChange={(e) => setText(e.target.value)} />}
              </Field>
              <DialogFooter>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" loading={saving} disabled={!loaded}>Save note</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
