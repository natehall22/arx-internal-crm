'use client'

import { useRef, useState } from 'react'

import { createClientBrowser } from '@/lib/supabase/client'
import { REQUIRED_FINAL_PHOTO_TAGS } from '@/lib/final-photo-tags'

/**
 * Crew walk-around. Field UI: plain "what goes where" labels, big targets,
 * dark text on a light ground (legible outdoors). One tap per shot — a browser
 * only opens the camera from a tap, so the flow advances to the next angle and
 * waits for the crew to tap again.
 */

const STEP_LABELS: Record<string, string> = {
  final_front: 'Front of house',
  final_back: 'Back of house',
  final_left: 'Left side',
  final_right: 'Right side',
}

/** Long edge in px. Phone originals are 3–8MB; this keeps uploads fast on one bar of signal. */
const MAX_EDGE = 2400

type Props = {
  token: string
  tradeLabel: string
  addressText: string | null
  jobNumber: string
  initialCounts: Record<string, number>
}

type UploadState = { status: 'idle' } | { status: 'uploading'; label: string } | { status: 'failed'; message: string; retry: () => void }

async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 2_500_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    // HEIC or anything the browser can't decode: send the original.
    return file
  }
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Upload failed')
  return data
}

export default function CrewPhotoCapture({ token, tradeLabel, addressText, jobNumber, initialCounts }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts)
  const [started, setStarted] = useState(false)
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' })
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const moreInputRef = useRef<HTMLInputElement>(null)

  const missing = REQUIRED_FINAL_PHOTO_TAGS.filter((t) => !counts[t])
  const currentStep = missing[0] ?? null
  const allRequiredDone = missing.length === 0
  const extraCount = counts.other_final ?? 0
  const busy = upload.status === 'uploading'

  async function uploadOne(file: File, tag: string, label: string): Promise<boolean> {
    setUpload({ status: 'uploading', label })
    try {
      const body = await shrinkImage(file)
      const reg = await postJson(`/api/crew/${token}/photos/register`, {
        filename: body === file ? file.name || 'photo.jpg' : 'photo.jpg',
      })
      const { error } = await createClientBrowser()
        .storage.from(String(reg.bucket))
        .uploadToSignedUrl(String(reg.storagePath), String(reg.signedUploadToken), body, {
          contentType: body.type || 'image/jpeg',
        })
      if (error) throw new Error('Upload failed — check signal and try again')
      await postJson(`/api/crew/${token}/photos/finalize`, {
        photoId: reg.photoId,
        photo_tag: tag,
        mime_type: body.type || 'image/jpeg',
        file_size: body.size,
      })
      setCounts((c) => ({ ...c, [tag]: (c[tag] ?? 0) + 1 }))
      setUpload({ status: 'idle' })
      return true
    } catch (e) {
      setUpload({
        status: 'failed',
        message: e instanceof Error ? e.message : 'Upload failed',
        retry: () => void uploadOne(file, tag, label),
      })
      return false
    }
  }

  async function onCameraPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !currentStep) return
    await uploadOne(file, currentStep, STEP_LABELS[currentStep])
  }

  async function onMorePhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (let i = 0; i < files.length; i++) {
      const ok = await uploadOne(files[i], 'other_final', `Photo ${i + 1} of ${files.length}`)
      if (!ok) return
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f6f2] px-4 pb-10 pt-6 text-[#2c2c2a]">
      <div className="mx-auto max-w-md">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#57574f]">ARX Roofing · Job #{jobNumber}</p>
        <h1 className="mt-1 text-2xl font-bold">{tradeLabel} photos</h1>
        {addressText && <p className="mt-1 text-lg">{addressText}</p>}

        <ol className="mt-5 space-y-2">
          {REQUIRED_FINAL_PHOTO_TAGS.map((tag) => {
            const done = Boolean(counts[tag])
            return (
              <li
                key={tag}
                className={`flex min-h-[52px] items-center justify-between rounded-lg border px-4 text-lg ${
                  done ? 'border-emerald-300 bg-emerald-50' : 'border-[#d6d3ca] bg-white'
                }`}
              >
                <span className="font-medium">{STEP_LABELS[tag]}</span>
                <span className={`font-bold ${done ? 'text-emerald-800' : 'text-[#57574f]'}`}>{done ? '✓ Done' : '—'}</span>
              </li>
            )
          })}
        </ol>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onCameraPhoto}
        />
        <input ref={moreInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onMorePhotos} />

        <div className="mt-6">
          {upload.status === 'uploading' && (
            <div className="rounded-lg border border-[#d6d3ca] bg-white px-4 py-5 text-center text-lg font-semibold" role="status">
              Uploading {upload.label}…
            </div>
          )}

          {upload.status === 'failed' && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-4" role="alert">
              <p className="text-base font-semibold text-red-900">{upload.message}</p>
              <button
                type="button"
                onClick={upload.retry}
                className="mt-3 min-h-[56px] w-full rounded-lg bg-red-700 text-lg font-bold text-white"
              >
                Try again
              </button>
            </div>
          )}

          {upload.status === 'idle' && !allRequiredDone && (
            <button
              type="button"
              onClick={() => {
                setStarted(true)
                cameraInputRef.current?.click()
              }}
              className="min-h-[64px] w-full rounded-xl bg-[#2c2c2a] px-4 text-xl font-bold text-white active:bg-black"
            >
              {started || missing.length < REQUIRED_FINAL_PHOTO_TAGS.length
                ? `Take photo: ${STEP_LABELS[currentStep as string]}`
                : 'Take photos'}
            </button>
          )}

          {upload.status === 'idle' && allRequiredDone && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-5 text-center">
              <p className="text-xl font-bold text-emerald-900">All 4 photos done ✓</p>
              <p className="mt-1 text-base">Add close-ups or anything ARX should see.</p>
            </div>
          )}

          {(allRequiredDone || extraCount > 0) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => moreInputRef.current?.click()}
              className="mt-3 min-h-[56px] w-full rounded-xl border-2 border-[#2c2c2a] bg-white px-4 text-lg font-bold disabled:opacity-50"
            >
              Add more photos{extraCount > 0 ? ` (${extraCount} added)` : ''}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
