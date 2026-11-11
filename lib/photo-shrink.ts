/**
 * Phone photos before upload (browser only): long edge capped, re-encoded as JPEG. Used by every crew photo page
 * (`/crew/[token]` walk-around, `/crew/day/[token]` visits) — one copy.
 */
/** Long edge in px. Phone originals are 3–8MB; this keeps uploads fast on one bar of signal. */
const MAX_EDGE = 2400

export async function shrinkImage(file: File): Promise<Blob> {
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

