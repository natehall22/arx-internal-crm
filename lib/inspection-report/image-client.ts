/**
 * Browser-side image processing for the report builder.
 * Same pipeline as the standalone builder: HEIC → JPEG, downscale to 1280px, q0.8,
 * rotation baked only at PDF export time.
 */

export interface ProcessedPhoto {
  bytes: Uint8Array
  width: number
  height: number
}

function loadImageFromBlob(blob: Blob): Promise<{ im: HTMLImageElement; url: string }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob)
    const im = new Image()
    im.onload = () => res({ im, url })
    im.onerror = (e) => {
      URL.revokeObjectURL(url)
      rej(e)
    }
    im.src = url
  })
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Draw to canvas applying rotation, downscale so longest side <= maxSide, return JPEG bytes. */
export function renderToJpeg(
  im: HTMLImageElement,
  rotation: number,
  maxSide: number,
  quality: number
): ProcessedPhoto {
  const w = im.naturalWidth || im.width
  const h = im.naturalHeight || im.height
  const swap = rotation === 90 || rotation === 270
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const sw = Math.round(w * scale)
  const sh = Math.round(h * scale)
  const cw = swap ? sh : sw
  const ch = swap ? sw : sh
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = ch
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, cw, ch)
  ctx.save()
  ctx.translate(cw / 2, ch / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(im, -sw / 2, -sh / 2, sw, sh)
  ctx.restore()
  const dataUrl = cv.toDataURL('image/jpeg', quality)
  return { bytes: b64ToBytes(dataUrl.split(',')[1]), width: cw, height: ch }
}

/** File (JPEG/PNG/HEIC/…) → compressed JPEG ready for upload + embedding. */
export async function processFile(file: File): Promise<ProcessedPhoto> {
  let blob: Blob = file
  const name = (file.name || '').toLowerCase()
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  if (isHeic) {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    blob = Array.isArray(converted) ? converted[0] : converted
  }
  const { im, url } = await loadImageFromBlob(blob)
  try {
    return renderToJpeg(im, 0, 1280, 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Re-encode stored JPEG bytes at a quality tier with rotation baked (PDF embedding). */
export async function reencodeJpeg(
  jpegBytes: Uint8Array,
  rotation: number,
  quality: number,
  maxSide: number
): Promise<ProcessedPhoto> {
  const { im, url } = await loadImageFromBlob(new Blob([jpegBytes.slice().buffer], { type: 'image/jpeg' }))
  try {
    return renderToJpeg(im, rotation, maxSide, quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}
