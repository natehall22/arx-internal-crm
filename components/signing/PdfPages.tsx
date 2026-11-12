'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Draws a PDF page by page (pdf.js, the "legacy" build so older Android browsers work) and lets the caller lay things over each
 * page. Pages render when they come near the screen, at the width they are shown (not the PDF's size), so a 60-page document
 * on a cheap phone stays light. Position = fractions of the page, so overlays line up at any zoom.
 */
export type PageSize = { width: number; height: number }

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> }

let workerReady = false
async function loadPdfjs() {
  // The "legacy" build runs on older phones. The worker is served from /public (a copy of the package file, kept equal by
  // lib/__tests__/pdfjs-worker-copy.test.ts), NOT bundled: webpack's minifier cannot parse the already-minified module worker.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
    workerReady = true
  }
  return pdfjs
}

export default function PdfPages({
  source,
  onLoaded,
  renderOverlay,
  maxWidth = 900,
  onPagePointer,
}: {
  /** A URL (same origin) or the bytes of a PDF the person just chose. */
  source: string | ArrayBuffer | null
  onLoaded?: (pages: PageSize[]) => void
  renderOverlay?: (page: number) => ReactNode
  maxWidth?: number
  /** A tap / click on empty page: (page, x, y) as fractions. */
  onPagePointer?: (page: number, x: number, y: number) => void
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(240, Math.min(maxWidth, Math.floor(el.clientWidth))))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxWidth])

  useEffect(() => {
    if (!source) return
    let live = true
    let task: { destroy?: () => void } | null = null
    setError(null)
    setPdf(null) // a new source: drop the old pages so they never sit under a Loading or error message
    setSizes([])
    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        const data = typeof source === 'string' ? await fetch(source, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('fetch'); return r.arrayBuffer() }) : source.slice(0)
        task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false })
        const doc: PdfDoc = await (task as any).promise
        const s: PageSize[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
          s.push({ width: vp.width, height: vp.height })
        }
        if (!live) return
        setPdf(doc)
        setSizes(s)
        onLoaded?.(s)
      } catch {
        if (live) setError('This document could not be shown. Check your connection and reload.')
      }
    })()
    return () => { live = false; task?.destroy?.() }
    // onLoaded is a callback the parent may recreate; the document only reloads when the source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  return (
    <div ref={wrapRef} className="w-full">
      {error && <p className="rounded-lg border border-red-300 bg-white p-4 text-base text-red-800">{error}</p>}
      {!error && !pdf && <p className="p-4 text-base text-[#2c2c2a]">Loading the document…</p>}
      {pdf && sizes.map((s, i) => (
        <PageView key={i} pdf={pdf} index={i} size={s} width={width} overlay={renderOverlay?.(i)} onPointer={onPagePointer} />
      ))}
    </div>
  )
}

function PageView({ pdf, index, size, width, overlay, onPointer }: { pdf: PdfDoc; index: number; size: PageSize; width: number; overlay?: ReactNode; onPointer?: (page: number, x: number, y: number) => void }) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(index < 2)
  const height = useMemo(() => Math.round((size.height / size.width) * width), [size, width])

  useEffect(() => {
    const el = holder.current
    if (!el || near || typeof IntersectionObserver === 'undefined') { if (typeof IntersectionObserver === 'undefined') setNear(true); return }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setNear(true) }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(index + 1)
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
      const vp = page.getViewport({ scale: (width / size.width) * dpr })
      const c = canvas.current
      if (!c || cancelled) return
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      const ctx = c.getContext('2d')
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [near, pdf, index, width, size.width])

  return (
    <div
      ref={holder}
      data-page={index}
      className="relative mx-auto mb-3 select-none overflow-hidden bg-white shadow ring-1 ring-gray-300"
      style={{ width, height, touchAction: 'pan-y' }}
      onClick={(e) => {
        if (!onPointer) return
        if ((e.target as HTMLElement).closest('[data-field]')) return
        const r = e.currentTarget.getBoundingClientRect()
        onPointer(index, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
      }}
    >
      <canvas ref={canvas} style={{ width, height }} aria-label={`Page ${index + 1}`} />
      {overlay}
    </div>
  )
}
