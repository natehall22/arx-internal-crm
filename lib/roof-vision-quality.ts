export type VisionPixelPoint = [number, number]

export type VisionFacetLike = {
  vertices: VisionPixelPoint[]
}

type PixelBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

function finiteVertices(vertices: VisionPixelPoint[]): VisionPixelPoint[] {
  return vertices.filter(
    ([x, y]) => Number.isFinite(Number(x)) && Number.isFinite(Number(y))
  )
}

function polygonAreaPx(vertices: VisionPixelPoint[]): number {
  const pts = finiteVertices(vertices)
  if (pts.length < 3) return 0

  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    sum += Number(x1) * Number(y2) - Number(x2) * Number(y1)
  }

  return Math.abs(sum / 2)
}

function pixelBox(vertices: VisionPixelPoint[]): PixelBox | null {
  const pts = finiteVertices(vertices)
  if (pts.length < 3) return null

  const xs = pts.map(([x]) => Number(x))
  const ys = pts.map(([, y]) => Number(y))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = maxX - minX
  const height = maxY - minY
  if (width <= 0 || height <= 0) return null

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  }
}

function bboxFillRatio(vertices: VisionPixelPoint[]): number {
  const box = pixelBox(vertices)
  if (!box) return 0
  return polygonAreaPx(vertices) / (box.width * box.height)
}

function axisAlignedEdgeRatio(vertices: VisionPixelPoint[]): number {
  const pts = finiteVertices(vertices)
  if (pts.length < 3) return 0

  let total = 0
  let aligned = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    const dx = Math.abs(Number(x2) - Number(x1))
    const dy = Math.abs(Number(y2) - Number(y1))
    const length = Math.hypot(dx, dy)
    if (length <= 0) continue
    total += length
    if (dx <= 3 || dy <= 3) aligned += length
  }

  return total > 0 ? aligned / total : 0
}

function roundedDistinctCount(values: number[], bucketPx = 6): number {
  return new Set(values.map((value) => Math.round(Number(value) / bucketPx))).size
}

function horizontalOverlapRatio(a: PixelBox, b: PixelBox): number {
  const overlap = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const minWidth = Math.max(1, Math.min(a.width, b.width))
  return overlap / minWidth
}

export function isPlaceholderVisionFacet(facet: VisionFacetLike): boolean {
  const vertices = finiteVertices(facet.vertices || [])
  const box = pixelBox(vertices)
  if (!box || vertices.length < 5) return false
  if (box.width < 18 || box.height < 18) return false

  const fill = bboxFillRatio(vertices)
  const axisRatio = axisAlignedEdgeRatio(vertices)
  const uniqueX = roundedDistinctCount(vertices.map(([x]) => Number(x)))
  const uniqueY = roundedDistinctCount(vertices.map(([, y]) => Number(y)))

  return fill >= 0.78 && axisRatio >= 0.72 && (uniqueX <= 3 || uniqueY <= 3)
}

export function isStackedBandVisionTrace(facets: VisionFacetLike[]): boolean {
  const boxes = facets
    .map((facet) => {
      const box = pixelBox(facet.vertices || [])
      if (!box) return null
      return {
        box,
        fill: bboxFillRatio(facet.vertices || []),
        axisRatio: axisAlignedEdgeRatio(facet.vertices || []),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.box.width >= 30 && item.box.height >= 16 && item.fill >= 0.55 && item.axisRatio >= 0.5)

  if (boxes.length < 3) return false

  for (let i = 0; i < boxes.length; i++) {
    const group = boxes.filter((candidate) => horizontalOverlapRatio(boxes[i].box, candidate.box) >= 0.68)
    if (group.length < 3) continue

    const minCenterY = Math.min(...group.map((item) => item.box.centerY))
    const maxCenterY = Math.max(...group.map((item) => item.box.centerY))
    const medianHeight = [...group.map((item) => item.box.height)].sort((a, b) => a - b)[Math.floor(group.length / 2)]

    if (maxCenterY - minCenterY >= medianHeight * 1.15) return true
  }

  return false
}
