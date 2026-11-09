'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { useFileDrop } from '@/components/files/useFileDrop'
import { CUSTOMER_FILE_MAX_BYTES } from '@/lib/customer-file/customer-files'
import { createClientBrowser } from '@/lib/supabase/client'

type Status = 'waiting' | 'uploading' | 'saving' | 'done' | 'error'
type Item = { key: string; file: File; status: Status; error?: string }

const MAX_MB = Math.round(CUSTOMER_FILE_MAX_BYTES / 1024 / 1024)

const STATUS_LABEL: Record<Status, string> = {
  waiting: 'Waiting…',
  uploading: 'Uploading…',
  saving: 'Saving…',
  done: 'Added',
  error: 'Failed',
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = { error: text.slice(0, 160) }
  }
  if (!res.ok) throw new Error(String(data.error || `Upload failed (HTTP ${res.status})`))
  return data
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * "Add files" for a customer: tap to pick (several at once) or drag files onto the box. Each file goes browser → private
 * `files` bucket through a signed upload (POST ./files/register → storage → ./files/finalize), one at a time, with its own
 * status line; the server-rendered list refreshes when the batch finishes.
 */
export default function CustomerFilesUpload({ customerId }: { customerId: string }) {
  const router = useRouter()
  const supabase = useMemo(() => createClientBrowser(), [])
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [addedNote, setAddedNote] = useState<string | null>(null)
  const running = useRef(false)
  const seq = useRef(0)

  const patch = useCallback(
    (key: string, next: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...next } : it))),
    []
  )

  const uploadOne = useCallback(
    async (item: Item) => {
      const { file } = item
      if (file.size > CUSTOMER_FILE_MAX_BYTES) throw new Error(`Too large — files must be ${MAX_MB} MB or smaller`)
      patch(item.key, { status: 'uploading', error: undefined })
      const base = `/api/customers/${encodeURIComponent(customerId)}/files`
      const reg = await postJson(`${base}/register`, { fileName: file.name, size: file.size })
      const { error } = await supabase.storage
        .from(String(reg.bucket))
        .uploadToSignedUrl(String(reg.storagePath), String(reg.signedUploadToken), file, {
          contentType: file.type || 'application/octet-stream',
        })
      if (error) throw new Error(error.message || 'Upload failed')
      patch(item.key, { status: 'saving' })
      await postJson(`${base}/finalize`, { fileId: reg.fileId, fileName: file.name })
      patch(item.key, { status: 'done' })
    },
    [customerId, supabase, patch]
  )

  // Works through every waiting file, one at a time; files added mid-batch join the same run.
  const pump = useCallback(
    async (queue: () => Item | undefined) => {
      if (running.current) return
      running.current = true
      let added = 0
      try {
        for (let next = queue(); next; next = queue()) {
          try {
            await uploadOne(next)
            added++
          } catch (e) {
            patch(next.key, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' })
          }
        }
      } finally {
        running.current = false
        if (added > 0) {
          // The refreshed list below now shows them; keep only failures (and anything still queued) up here.
          setItems((prev) => prev.filter((i) => i.status !== 'done'))
          setAddedNote(`${added} file${added === 1 ? '' : 's'} added`)
          router.refresh()
        }
      }
    },
    [uploadOne, router, patch]
  )

  const itemsRef = useRef<Item[]>([])
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  const claimed = useRef(new Set<string>())
  const nextWaiting = useCallback(() => {
    const it = itemsRef.current.find((i) => i.status === 'waiting' && !claimed.current.has(i.key))
    if (it) claimed.current.add(it.key)
    return it
  }, [])

  useEffect(() => {
    if (items.some((i) => i.status === 'waiting' && !claimed.current.has(i.key))) void pump(nextWaiting)
  }, [items, pump, nextWaiting])

  const addFiles = useCallback((files: File[]) => {
    const fresh = files.filter((f) => f.size > 0).map((file) => ({ key: `f${++seq.current}`, file, status: 'waiting' as Status }))
    if (fresh.length === 0) return
    setAddedNote(null)
    setItems((prev) => [...prev.filter((i) => i.status !== 'done'), ...fresh])
  }, [])

  const retry = (key: string) => {
    claimed.current.delete(key)
    patch(key, { status: 'waiting', error: undefined })
  }
  const dismiss = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key))

  const drop = useFileDrop(addFiles)
  const busy = items.some((i) => i.status === 'waiting' || i.status === 'uploading' || i.status === 'saving')

  return (
    <div className="mb-4">
      <div
        {...drop.bind}
        role="region"
        aria-label="Add files: drop zone"
        className={`rounded-ui border-2 border-dashed p-4 text-center transition-colors ${
          drop.active ? 'border-brand-600 bg-brand-50' : 'border-surface-line bg-surface'
        }`}
      >
        <Button type="button" onClick={() => inputRef.current?.click()} className="w-full sm:w-auto">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add files
        </Button>
        <p className="mt-2 text-ui-sm text-ink">
          {drop.active ? 'Drop to add them' : 'or drag files here'} · photos, PDFs, any file up to {MAX_MB} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Choose files to add"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>

      {addedNote && !busy && (
        <p className="mt-2 text-ui-sm font-medium text-ink" role="status">
          ✓ {addedNote}
        </p>
      )}

      {items.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite" aria-busy={busy || undefined}>
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-3 rounded-ui border border-surface-line bg-surface p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui-sm font-medium text-ink">{it.file.name}</p>
                <p className={`text-ui-sm ${it.status === 'error' ? 'text-danger' : 'text-ink-muted'}`}>
                  {formatSize(it.file.size)} · {it.status === 'error' ? it.error || 'Failed' : STATUS_LABEL[it.status]}
                </p>
                {(it.status === 'uploading' || it.status === 'saving') && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-subtle" role="progressbar" aria-label={`${it.file.name} ${STATUS_LABEL[it.status]}`}>
                    <div className={`h-full bg-brand-600 transition-all ${it.status === 'uploading' ? 'w-1/2 animate-pulse' : 'w-11/12'}`} />
                  </div>
                )}
              </div>
              {it.status === 'error' && (
                <>
                  <Button type="button" variant="secondary" size="sm" onClick={() => retry(it.key)}>Retry</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => dismiss(it.key)} aria-label={`Dismiss ${it.file.name}`}>✕</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
