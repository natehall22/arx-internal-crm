'use client'

import { useRef, useState } from 'react'

import { uploadTaggedPhotos } from '@/lib/visit-photo-upload'
import { btnGhost, btnPrimary, inputCls } from './ui'

/**
 * The one-tap daily log form, shared by the job page (office) and the crew link. Write a note, add photos (tap the button, or
 * drop them on the box), Save. Weather fills in by itself on the server; type over it only if it is wrong. The office can
 * tick "Send summary to customer". `photoBase` is the job photo API the photos go through; `post` saves the log.
 */
export default function DailyLogForm({
  photoBase,
  post,
  canSendSummary,
  placeholder = 'What got done today?',
}: {
  photoBase: string
  post: (body: { note: string; photoIds: string[]; weather: string; sendSummary: boolean }) => Promise<string | null>
  canSendSummary: boolean
  placeholder?: string
}) {
  const [note, setNote] = useState('')
  const [weather, setWeather] = useState('')
  const [showWeather, setShowWeather] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [send, setSend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)

  function addFiles(list: FileList | File[] | null) {
    const imgs = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (imgs.length) setFiles((cur) => [...cur, ...imgs].slice(0, 20))
  }

  async function save() {
    setError(null)
    if (!note.trim() && files.length === 0) return setError('Write a note or add a photo')
    setBusy(true)
    const up = files.length ? await uploadTaggedPhotos(photoBase, files, 'daily_log') : { ids: [] as string[], error: null }
    if (up.error) {
      // Keep what is left so a retry does not upload the same photos twice.
      setFiles((cur) => cur.slice(up.ids.length))
      setBusy(false)
      return setError(up.error)
    }
    const err = await post({ note, photoIds: up.ids, weather, sendSummary: send })
    setBusy(false)
    if (err) return setError(err)
    setNote('')
    setWeather('')
    setFiles([])
    setSend(false)
  }

  return (
    <div className="space-y-3" data-testid="daily-log-form">
      <textarea className={`${inputCls} min-h-[96px] py-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} aria-label="Daily log note" />
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
        className={`rounded-lg border-2 border-dashed p-3 text-center ${over ? 'border-[#1f2937] bg-[#f1efe8]' : 'border-[#a8a69f]'}`}
        data-testid="daily-log-drop"
      >
        <input ref={pick} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <button type="button" className={btnGhost} onClick={() => pick.current?.click()}>Add photos</button>
        <p className="mt-1 text-sm text-[#2c2c2a]">{files.length ? `${files.length} photo${files.length === 1 ? '' : 's'} ready` : 'or drop photos here'}</p>
      </div>
      {showWeather ? (
        <input className={inputCls} value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="Weather (fills in by itself)" aria-label="Weather" />
      ) : (
        <button type="button" className="min-h-[44px] text-base font-semibold text-[#1d4ed8] underline" onClick={() => setShowWeather(true)}>Weather fills in by itself. Change it</button>
      )}
      {canSendSummary ? (
        <label className="flex min-h-[44px] items-center gap-3 text-base text-[#2c2c2a]">
          <input type="checkbox" className="h-6 w-6" checked={send} onChange={(e) => setSend(e.target.checked)} /> Send summary to customer
        </label>
      ) : null}
      {error ? <p role="alert" className="text-base font-semibold text-[#7f1d1d]">{error}</p> : null}
      <button type="button" className={`${btnPrimary} w-full`} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save log'}</button>
    </div>
  )
}
