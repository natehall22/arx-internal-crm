import { qrMatrix } from '@/lib/qr'

/**
 * A QR code as an SVG: black on white with the 4-module quiet zone scanners need, whatever the page colour (a phone in the
 * sun scans black on white best). `label` is read out for screen readers; nothing else about the link is shown.
 */
export function QrCode({ value, size = 224, label = 'QR code' }: { value: string; size?: number; label?: string }) {
  const grid = qrMatrix(value)
  if (!grid) return null
  const n = grid.length
  const pad = 4
  const cells: string[] = []
  grid.forEach((row, y) => {
    let x = 0
    while (x < n) {
      if (!row[x]) {
        x++
        continue
      }
      let run = 1
      while (x + run < n && row[x + run]) run++
      cells.push(`M${x + pad} ${y + pad}h${run}v1h-${run}z`)
      x += run
    }
  })
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n + pad * 2} ${n + pad * 2}`} width={size} height={size} shapeRendering="crispEdges" className="max-w-full rounded-lg bg-white">
      <rect width="100%" height="100%" fill="#ffffff" />
      <path d={cells.join('')} fill="#000000" />
    </svg>
  )
}
