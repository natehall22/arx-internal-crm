/**
 * Line lidar sections up with the satellite photo the rep is editing on.
 *
 * Lidar positions are survey-accurate, but Google's satellite imagery isn't: buildings
 * lean in off-nadir photos and the mosaic's georeferencing drifts, so the true roof and
 * the photographed roof sit 0.5–3.6 m apart house to house (measured on 9 carrier
 * fixtures, 2026-09-26). That varies per image, so no fixed datum shift fixes it.
 *
 * Instead: render the lidar section outlines, slide them over the photo's edge map
 * (Sobel gradient) within ±7 m, and keep the offset where they sit on the strongest
 * edges. Shapes, areas and lengths are untouched — only where they're drawn moves.
 * Returns a zero shift when the match isn't clearly better than leaving them put.
 */
import sharp from 'sharp'

export type RegisterResult = { eastM: number; northM: number; confident: boolean; gain: number }

const MAX_SHIFT_M = 7

export async function registerOutlinesToImage(params: {
  /** Section outlines in local metres (x east, y north) around the image centre. */
  outlines: { x: number; y: number }[][]
  /** Satellite image (any format sharp reads) centred on the same point. */
  image: Buffer
  /** Metres per image pixel. */
  metersPerPixel: number
}): Promise<RegisterResult> {
  const { data, info } = await sharp(params.image).greyscale().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  // Sobel gradient magnitude, then a light 3×3 blur so near-misses still score.
  const grad = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = -data[i - W - 1] - 2 * data[i - 1] - data[i + W - 1] + data[i - W + 1] + 2 * data[i + 1] + data[i + W + 1]
      const gy = -data[i - W - 1] - 2 * data[i - W] - data[i - W + 1] + data[i + W - 1] + 2 * data[i + W] + data[i + W + 1]
      grad[i] = Math.hypot(gx, gy)
    }
  }
  const blur = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += grad[(y + dy) * W + x + dx]
      blur[y * W + x] = s / 9
    }
  }

  // Sample points every ~0.25 m along every outline edge, in pixel offsets from centre.
  const mpp = params.metersPerPixel
  const samples: [number, number][] = []
  for (const ring of params.outlines) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const steps = Math.max(1, Math.round(len / 0.25))
      for (let t = 0; t < steps; t++) {
        const x = a.x + ((b.x - a.x) * t) / steps
        const y = a.y + ((b.y - a.y) * t) / steps
        samples.push([x / mpp, -y / mpp])
      }
    }
  }
  if (samples.length === 0) return { eastM: 0, northM: 0, confident: false, gain: 1 }

  const cx = W / 2, cy = H / 2
  const score = (sx: number, sy: number) => {
    let s = 0
    for (const [px, py] of samples) {
      const x = Math.round(cx + px + sx), y = Math.round(cy + py + sy)
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) s += blur[y * W + x]
    }
    return s / samples.length
  }
  // The survey position is the prior: a shift must beat staying put by more the further it
  // goes (Gaussian, 2.5 m), or edge matching latches onto a neighbour's roof or driveway.
  const prior = (sx: number, sy: number) => Math.exp(-((sx * mpp) ** 2 + (sy * mpp) ** 2) / (2 * 2.5 ** 2))
  const maxPx = Math.round(MAX_SHIFT_M / mpp)
  const stride = Math.max(1, Math.round(0.2 / mpp))
  const base = score(0, 0)
  let best = { sx: 0, sy: 0, s: base, w: base }
  const consider = (sx: number, sy: number) => {
    const s = score(sx, sy)
    const w = s * prior(sx, sy)
    if (w > best.w) best = { sx, sy, s, w }
  }
  for (let sy = -maxPx; sy <= maxPx; sy += stride) for (let sx = -maxPx; sx <= maxPx; sx += stride) consider(sx, sy)
  // refine at single-pixel steps around the best coarse offset
  const coarse = best
  for (let sy = coarse.sy - stride; sy <= coarse.sy + stride; sy++) for (let sx = coarse.sx - stride; sx <= coarse.sx + stride; sx++) consider(sx, sy)
  const gain = base > 0 ? best.s / base : 1
  // Only move when the photo clearly agrees better (≥ 30% stronger edges) — otherwise leave
  // the survey position alone rather than chase shadows or tree lines.
  const confident = gain >= 1.3
  return confident
    ? { eastM: best.sx * mpp, northM: -best.sy * mpp, confident, gain }
    : { eastM: 0, northM: 0, confident, gain }
}
