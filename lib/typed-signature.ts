/**
 * A typed name drawn as a signature image (PNG data URL) on a canvas. Client only. Used where a change order needs the
 * company's signature but the person has already tapped "send" (project tools selections): their name, in a script face,
 * is the company's signature on that change order, the same as a typed signature on a contract.
 */
export function typedSignatureDataUrl(name: string): string | null {
  if (typeof document === 'undefined') return null
  const text = name.trim().slice(0, 60)
  if (!text) return null
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 150
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111827'
  ctx.textBaseline = 'middle'
  let size = 72
  ctx.font = `italic ${size}px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive`
  while (ctx.measureText(text).width > 560 && size > 24) {
    size -= 4
    ctx.font = `italic ${size}px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive`
  }
  ctx.fillText(text, 20, 78)
  return canvas.toDataURL('image/png')
}
