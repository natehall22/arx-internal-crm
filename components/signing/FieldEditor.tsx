'use client'

import { useRef, useState } from 'react'

import PdfPages, { type PageSize } from '@/components/signing/PdfPages'
import { DEFAULT_FIELD_SIZE, FIELD_KINDS, FIELD_LABELS, type FieldKind, type PlacedField, type RoleDef } from '@/lib/signing/requests/types'

/** One look per signer: a letter badge + an outline pattern, so colour is never the only difference. */
const ROLE_STYLE = [
  { box: 'border-blue-700 bg-blue-100/70', chip: 'bg-blue-700 text-white', badge: 'A' },
  { box: 'border-emerald-700 bg-emerald-100/70', chip: 'bg-emerald-700 text-white', badge: 'B' },
  { box: 'border-purple-700 bg-purple-100/70', chip: 'bg-purple-700 text-white', badge: 'C' },
  { box: 'border-orange-700 bg-orange-100/70', chip: 'bg-orange-700 text-white', badge: 'D' },
  { box: 'border-rose-700 bg-rose-100/70', chip: 'bg-rose-700 text-white', badge: 'E' },
]
const styleOf = (roles: readonly RoleDef[], key: string) => ROLE_STYLE[Math.max(0, roles.findIndex((r) => r.key === key)) % ROLE_STYLE.length]

let counter = 0
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Place fields on a PDF: pick WHO signs and WHAT the field is, then tap the page. Tap a field to select it, drag it to move,
 * use the bar to resize, make optional or delete. Works with a finger or a mouse (pointer events, 44px+ controls).
 */
export default function FieldEditor({ source, roles, fields, onChange, onLoaded }: { source: string | ArrayBuffer | null; roles: readonly RoleDef[]; fields: PlacedField[]; onChange: (f: PlacedField[]) => void; onLoaded?: (pages: PageSize[]) => void }) {
  const [role, setRole] = useState(roles[0]?.key ?? '')
  const [kind, setKind] = useState<FieldKind>('signature')
  const [selected, setSelected] = useState<string | null>(null)
  const sizes = useRef<PageSize[]>([])
  const activeRole = roles.some((r) => r.key === role) ? role : roles[0]?.key ?? ''
  const sel = fields.find((f) => f.id === selected) ?? null

  const place = (page: number, x: number, y: number) => {
    const d = DEFAULT_FIELD_SIZE[kind]
    const ps = sizes.current[page]
    // Keep the field's real-world shape on pages that are not letter sized.
    const h = ps ? d.h * (792 / ps.height) * (ps.width / 612) : d.h
    const f: PlacedField = { id: newId(), roleKey: activeRole, kind, page, x: clamp(x - d.w / 2, 0, 1 - d.w), y: clamp(y - h / 2, 0, 1 - h), w: d.w, h, required: true }
    onChange([...fields, f])
    setSelected(f.id)
  }
  const update = (id: string, patch: Partial<PlacedField>) => onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; w: number; h: number; pw: number; ph: number } | null>(null)

  return (
    <div className="text-[#2c2c2a]">
      <div className="sticky top-0 z-20 -mx-3 border-b border-gray-300 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Who signs this field">
          {roles.map((r) => (
            <button key={r.key} type="button" role="radio" aria-checked={r.key === activeRole} onClick={() => setRole(r.key)} className={`min-h-[44px] rounded-full border-2 px-3 text-base font-semibold ${r.key === activeRole ? `${styleOf(roles, r.key).chip} border-black` : 'border-gray-400 bg-white text-[#2c2c2a]'}`}>
              {styleOf(roles, r.key).badge} · {r.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Field type">
          {FIELD_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={k === kind} onClick={() => setKind(k)} className={`min-h-[44px] shrink-0 rounded-lg border-2 px-3 text-base font-medium ${k === kind ? 'border-black bg-gray-900 text-white' : 'border-gray-400 bg-white text-[#2c2c2a]'}`}>
              {FIELD_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-base">Tap the page to add a <strong>{FIELD_LABELS[kind].toLowerCase()}</strong> for <strong>{roles.find((r) => r.key === activeRole)?.label}</strong>. {fields.length} placed.</p>
      </div>

      <div className="mt-3">
        <PdfPages
          source={source}
          onLoaded={(s) => { sizes.current = s; onLoaded?.(s) }}
          onPagePointer={(p, x, y) => (sel ? setSelected(null) : place(p, x, y))}
          renderOverlay={(page) =>
            fields.filter((f) => f.page === page).map((f) => {
              const st = styleOf(roles, f.roleKey)
              return (
                <div
                  key={f.id}
                  data-field={f.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${FIELD_LABELS[f.kind]} for ${roles.find((r) => r.key === f.roleKey)?.label}${f.required ? '' : ' (optional)'}`}
                  className={`absolute flex items-center justify-between overflow-hidden rounded-sm border-2 text-sm font-semibold leading-none text-black ${st.box} ${f.id === selected ? 'ring-4 ring-black' : ''} ${f.required ? '' : 'border-dashed'}`}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, touchAction: 'none', cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSelected(f.id)
                    const parent = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                    drag.current = { id: f.id, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, w: f.w, h: f.h, pw: parent.width, ph: parent.height }
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.id !== f.id) return
                    update(f.id, { x: clamp(d.ox + (e.clientX - d.sx) / d.pw, 0, 1 - d.w), y: clamp(d.oy + (e.clientY - d.sy) / d.ph, 0, 1 - d.h) })
                  }}
                  onPointerUp={() => { drag.current = null }}
                  onKeyDown={(e) => {
                    const step = 0.01
                    if (e.key === 'Delete' || e.key === 'Backspace') { onChange(fields.filter((x) => x.id !== f.id)); setSelected(null) }
                    if (e.key === 'ArrowLeft') update(f.id, { x: clamp(f.x - step, 0, 1 - f.w) })
                    if (e.key === 'ArrowRight') update(f.id, { x: clamp(f.x + step, 0, 1 - f.w) })
                    if (e.key === 'ArrowUp') update(f.id, { y: clamp(f.y - step, 0, 1 - f.h) })
                    if (e.key === 'ArrowDown') update(f.id, { y: clamp(f.y + step, 0, 1 - f.h) })
                  }}
                >
                  <span className="truncate px-1">{st.badge} {FIELD_LABELS[f.kind]}</span>
                </div>
              )
            })
          }
        />
      </div>

      {sel && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-400 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg" role="toolbar" aria-label="Selected field">
          <p className="mb-2 text-base font-semibold">{FIELD_LABELS[sel.kind]} for {roles.find((r) => r.key === sel.roleKey)?.label}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-[44px] rounded-lg border-2 border-gray-500 px-4 text-base font-medium" onClick={() => update(sel.id, { w: clamp(sel.w * 0.85, 0.02, 1 - sel.x) })}>Narrower</button>
            <button type="button" className="min-h-[44px] rounded-lg border-2 border-gray-500 px-4 text-base font-medium" onClick={() => update(sel.id, { w: clamp(sel.w * 1.18, 0.02, 1 - sel.x) })}>Wider</button>
            <button type="button" className="min-h-[44px] rounded-lg border-2 border-gray-500 px-4 text-base font-medium" onClick={() => update(sel.id, { h: clamp(sel.h * 1.2, 0.01, 1 - sel.y) })}>Taller</button>
            <button type="button" className="min-h-[44px] rounded-lg border-2 border-gray-500 px-4 text-base font-medium" onClick={() => update(sel.id, { required: !sel.required })}>{sel.required ? 'Make optional' : 'Make required'}</button>
            <button type="button" className="min-h-[44px] rounded-lg border-2 border-red-700 px-4 text-base font-semibold text-red-800" onClick={() => { onChange(fields.filter((f) => f.id !== sel.id)); setSelected(null) }}>Delete</button>
            <button type="button" className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-base font-semibold text-white" onClick={() => setSelected(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
