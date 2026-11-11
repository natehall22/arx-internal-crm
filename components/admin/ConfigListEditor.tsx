'use client'

import * as React from 'react'

import { Badge, Button, Input } from '@/components/ui'

/**
 * Shared editor for a company's short config lists (Settings → Job setup: Trades; Settings → Custom fields; Cost codes
 * and Payment schedule next). Add, rename, reorder and turn on/off — never delete, because rows elsewhere
 * keep pointing at an item after it is turned off. Every change is handed to the parent, which saves
 * it through its one server route and passes the saved list back in.
 *
 * Phone-first: rows stack, every control is a ≥44px tap target, no hover-only or drag-only actions
 * (reorder is ↑ / ↓ buttons), inputs are 16px.
 */
export type ConfigListItem = { key: string; label: string; active: boolean }

type Props = {
  items: ConfigListItem[]
  /** Singular noun for copy and screen readers ("trade", "cost code"). */
  noun: string
  readOnly?: boolean
  maxLabelLength?: number
  /** One sentence under the list (what the order means, what "off" does). */
  hint?: string
  onAdd: (label: string) => Promise<boolean>
  onRename: (key: string, label: string) => Promise<boolean>
  onReorder: (keys: string[]) => Promise<boolean>
  onSetActive: (key: string, active: boolean) => Promise<boolean>
  /** How many items must stay on (Trades: 1, a job needs a crew; Custom fields: 0). */
  minActive?: number
  /** One line under an item's name (e.g. a field's type and choices). */
  renderDetail?: (key: string) => React.ReactNode
  /** Extra buttons beside Rename / Turn off (e.g. a field's settings). */
  renderActions?: (key: string, busy: boolean) => React.ReactNode
  /** Replaces the built-in "Add a …" name box when adding needs more than a name. */
  addForm?: React.ReactNode
}

export default function ConfigListEditor({ items, noun, readOnly = false, maxLabelLength = 40, hint, onAdd, onRename, onReorder, onSetActive, minActive = 1, renderDetail, renderActions, addForm }: Props) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<{ key: string; label: string } | null>(null)
  const [newLabel, setNewLabel] = React.useState('')
  const addId = React.useId()

  async function run(key: string, fn: () => Promise<boolean>): Promise<boolean> {
    setBusy(key)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by
    if (to < 0 || to >= items.length) return
    const keys = items.map((i) => i.key)
    ;[keys[index], keys[to]] = [keys[to], keys[index]]
    void run(`move:${items[index].key}`, () => onReorder(keys))
  }

  async function saveRename() {
    if (!editing) return
    const label = editing.label.trim()
    if (!label) return
    const ok = await run(`rename:${editing.key}`, () => onRename(editing.key, label))
    if (ok) setEditing(null)
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    const ok = await run('add', () => onAdd(label))
    if (ok) setNewLabel('')
  }

  const anyBusy = busy !== null
  const activeCount = items.filter((i) => i.active).length

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? <p className="text-ui-base text-ink">No {noun}s yet.</p> : null}
      <ol className={`flex flex-col divide-y divide-surface-line rounded-ui border border-surface-line bg-surface ${items.length === 0 ? 'hidden' : ''}`}>
        {items.map((item, index) => {
          const isEditing = editing?.key === item.key
          return (
            <li key={item.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
              {isEditing ? (
                <form
                  className="flex w-full flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void saveRename()
                  }}
                >
                  <Input
                    aria-label={`New name for ${item.label}`}
                    value={editing.label}
                    maxLength={maxLabelLength}
                    autoFocus
                    onChange={(e) => setEditing({ key: item.key, label: e.target.value })}
                    className="text-base sm:max-w-xs"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={busy === `rename:${item.key}`} disabled={!editing.label.trim()}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="w-6 shrink-0 text-right text-ui-sm font-semibold text-ink">{index + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block break-words text-ui-base font-semibold text-ink ${item.active ? '' : 'line-through decoration-1'}`}>{item.label}</span>
                      {renderDetail ? <span className="block break-words text-ui-sm text-ink">{renderDetail(item.key)}</span> : null}
                    </span>
                    {!item.active ? <Badge>Off</Badge> : null}
                    {!readOnly ? (
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" size="icon" variant="secondary" aria-label={`Move ${item.label} up`} disabled={anyBusy || index === 0} onClick={() => move(index, -1)}>
                          ↑
                        </Button>
                        <Button type="button" size="icon" variant="secondary" aria-label={`Move ${item.label} down`} disabled={anyBusy || index === items.length - 1} onClick={() => move(index, 1)}>
                          ↓
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {!readOnly ? (
                    <div className="flex flex-wrap gap-2 pl-8 sm:pl-0">
                      <Button type="button" size="sm" variant="secondary" disabled={anyBusy} onClick={() => setEditing({ key: item.key, label: item.label })}>
                        Rename
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={anyBusy || (item.active && activeCount <= minActive)}
                        loading={busy === `active:${item.key}`}
                        onClick={() => void run(`active:${item.key}`, () => onSetActive(item.key, !item.active))}
                      >
                        {item.active ? 'Turn off' : 'Turn on'}
                      </Button>
                      {renderActions ? renderActions(item.key, anyBusy) : null}
                    </div>
                  ) : null}
                </>
              )}
            </li>
          )
        })}
      </ol>

      {hint ? <p className="text-ui-sm text-ink">{hint}</p> : null}

      {!readOnly && addForm ? addForm : null}
      {!readOnly && !addForm ? (
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor={addId} className="text-ui-sm font-semibold text-ink">
              Add a {noun}
            </label>
            <Input id={addId} value={newLabel} maxLength={maxLabelLength} placeholder="Name" onChange={(e) => setNewLabel(e.target.value)} className="text-base" />
          </div>
          <Button type="submit" loading={busy === 'add'} disabled={anyBusy || !newLabel.trim()}>
            + Add {noun}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
