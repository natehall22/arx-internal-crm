/**
 * Roof planes and measurements from lidar BUILDING points — ARX's in-house answer to
 * paid aerial reports for complex roofs.
 *
 * Input: building-class points around one property, in local metres (x east, y north,
 * z up) with the pin at the origin. Pipeline:
 *   1. keep the building connected to the pin (1 m occupancy flood fill);
 *   2. RANSAC roof planes (local 3-point samples so one face = one plane);
 *   3. merge near-duplicate planes (overlapping flight lines stripe one face in two),
 *      reassign every point to its best plane;
 *   4. label a 0.5 m grid, close gaps, majority-smooth, fold slivers < 3 m² into neighbours;
 *   5. measure: sloped area per plane; every boundary between two planes is typed from 3D
 *      geometry — step (planes don't meet), convex fold → ridge (level) or hip (descends),
 *      concave fold → valley; exterior boundaries → eave or rake by the plane's downslope.
 *
 * Scored against carrier reports with scripts/lidar-roof-eval.ts (2026-09-26, 5 roofs):
 * squares within ~5% (Corriher 74.7 vs 74.02), ridge+hip cap ~14%, ridge ~12%.
 * Pure and deterministic (seeded RNG) so results are repeatable.
 */

export type LocalPoint = { x: number; y: number; z: number }
export type LidarPlane = {
  id: number
  /** z = a·x + b·y + c in local metres. */
  a: number
  b: number
  c: number
  pitchDegrees: number
  /** Compass bearing water runs toward. */
  drainAzimuthDegrees: number
  flatAreaM2: number
  slopedAreaM2: number
  /** This plane's own exterior edges: eave (level) and rake (true sloped length). */
  eaveM: number
  rakeM: number
  /** Outline in local metres (outer boundary, simplified), counter-clockwise. */
  outline: { x: number; y: number }[]
}
export type LidarEdgeType = 'ridge' | 'hip' | 'valley' | 'step' | 'unknown'
export type LidarEdge = { type: LidarEdgeType; lengthM: number; planeA: number; planeB: number }
export type LidarRoofResult = {
  planes: LidarPlane[]
  edges: LidarEdge[]
  totals: {
    squares: number
    flatSqft: number
    ridgeLf: number
    hipLf: number
    valleyLf: number
    eaveLf: number
    /** True (sloped) rake length. Ridge/eave are level; hip/valley are already sloped. */
    rakeLf: number
    /** Plane boundaries that are height steps (upper roof over lower) — wall/step flashing candidates. */
    stepLf: number
    unknownLf: number
  }
  buildingPoints: number
  pointsPerM2: number
}

const CELL = 0.5
const M2_TO_SQFT = 10.7639
const M_TO_FT = 3.28084
const NEIGHBOURS_4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const NEIGHBOURS_8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
const key = (i: number, j: number) => `${i},${j}`
const unkey = (k: string) => k.split(',').map(Number) as [number, number]

type Coef = [number, number, number]

function fitPlane(pts: LocalPoint[]): Coef | null {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxz = 0, syz = 0, sz = 0
  for (const p of pts) {
    sxx += p.x * p.x; sxy += p.x * p.y; sx += p.x; syy += p.y * p.y; sy += p.y; n++
    sxz += p.x * p.z; syz += p.y * p.z; sz += p.z
  }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
  const v = [sxz, syz, sz]
  const det = (A: number[][]) =>
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  const d = det(m)
  if (Math.abs(d) < 1e-9) return null
  const col = (k: number) => m.map((row, r) => row.map((val, c) => (c === k ? v[r] : val)))
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d]
}

const residual = (c: Coef, p: LocalPoint) => Math.abs(p.z - (c[0] * p.x + c[1] * p.y + c[2])) / Math.sqrt(1 + c[0] ** 2 + c[1] ** 2)
const zAt = (c: { a: number; b: number; c: number }, x: number, y: number) => c.a * x + c.b * y + c.c

function majority(counts: Map<number, number>): [number, number] | undefined {
  let best: [number, number] | undefined
  for (const e of Array.from(counts.entries())) if (!best || e[1] > best[1]) best = e
  return best
}

/** The connected building under (or nearest) the origin. */
function buildingUnderPin(points: LocalPoint[]): { pts: LocalPoint[]; footprintCells: number } {
  const occ = new Map<string, LocalPoint[]>()
  for (const p of points) {
    const k = key(Math.floor(p.x), Math.floor(p.y))
    const list = occ.get(k)
    if (list) list.push(p); else occ.set(k, [p])
  }
  let seed: string | null = null
  let best = Infinity
  for (const k of Array.from(occ.keys())) {
    const [i, j] = unkey(k)
    const d = Math.hypot(i + 0.5, j + 0.5)
    if (d < best) { best = d; seed = k }
  }
  // Nothing within ~12 m of the pin: the house isn't in this (2016–17) survey.
  if (!seed || best > 12) return { pts: [], footprintCells: 0 }
  const comp = new Set<string>()
  const stack = [seed]
  while (stack.length) {
    const k = stack.pop()!
    if (comp.has(k) || !occ.has(k)) continue
    comp.add(k)
    const [i, j] = unkey(k)
    for (const [di, dj] of NEIGHBOURS_8) stack.push(key(i + di, j + dj))
  }
  return { pts: Array.from(comp).flatMap((k) => occ.get(k)!), footprintCells: comp.size }
}

export function measureRoofFromLidar(
  points: LocalPoint[],
  opts: { toleranceM?: number; minPlaneAreaM2?: number; seed?: number } = {}
): LidarRoofResult | null {
  const tol = opts.toleranceM ?? 0.12
  const minArea = opts.minPlaneAreaM2 ?? 4
  const { pts, footprintCells } = buildingUnderPin(points)
  if (pts.length < 50) return null
  const density = pts.length / Math.max(1, footprintCells)
  const minPts = Math.max(12, Math.round(minArea * density * 0.6))

  // ── 2. RANSAC ──────────────────────────────────────────────────────────────
  let rng = opts.seed ?? 12345
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let pool = pts.slice()
  const found: Coef[] = []
  const members: LocalPoint[][] = []
  for (let iter = 0; iter < 60 && pool.length > minPts; iter++) {
    let bestC: Coef | null = null
    let bestCount = 0
    for (let t = 0; t < 400; t++) {
      const s0 = pool[Math.floor(rand() * pool.length)]
      const s1 = pool[Math.floor(rand() * pool.length)]
      const s2 = pool[Math.floor(rand() * pool.length)]
      if (Math.hypot(s0.x - s1.x, s0.y - s1.y) > 6 || Math.hypot(s0.x - s2.x, s0.y - s2.y) > 6) continue
      const c = fitPlane([s0, s1, s2])
      if (!c || Math.hypot(c[0], c[1]) > 2.2) continue // steeper than ~26/12: wall or noise
      let count = 0
      for (const p of pool) if (residual(c, p) < tol) count++
      if (count > bestCount) { bestCount = count; bestC = c }
    }
    if (!bestC || bestCount < minPts) break
    const refined = fitPlane(pool.filter((p) => residual(bestC!, p) < tol)) ?? bestC
    const inliers = pool.filter((p) => residual(refined, p) < tol)
    // Largest spatially connected patch only; coplanar faces elsewhere are found separately.
    const cells = new Map<string, LocalPoint[]>()
    for (const p of inliers) {
      const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL))
      const list = cells.get(k)
      if (list) list.push(p); else cells.set(k, [p])
    }
    const seen = new Set<string>()
    let bestPatch: string[] = []
    for (const k0 of Array.from(cells.keys())) {
      if (seen.has(k0)) continue
      const patch: string[] = []
      const st = [k0]
      while (st.length) {
        const k = st.pop()!
        if (seen.has(k) || !cells.has(k)) continue
        seen.add(k); patch.push(k)
        const [i, j] = unkey(k)
        for (const [di, dj] of [...NEIGHBOURS_8, [2, 0], [-2, 0], [0, 2], [0, -2]] as [number, number][]) st.push(key(i + di, j + dj))
      }
      if (patch.length > bestPatch.length) bestPatch = patch
    }
    const patchPts = bestPatch.flatMap((k) => cells.get(k)!)
    const taken = new Set<LocalPoint>(patchPts.length >= minPts ? patchPts : inliers)
    if (patchPts.length >= minPts) {
      found.push(fitPlane(patchPts) ?? refined)
      members.push(patchPts)
    }
    pool = pool.filter((p) => !taken.has(p))
  }
  if (found.length === 0) return null

  // ── 3. merge near-duplicates (normals ≤ 6°, surfaces ≤ 0.25 m apart) ──────────
  const normalAngle = (p: Coef, q: Coef) => {
    const dot = p[0] * q[0] + p[1] * q[1] + 1
    return (Math.acos(Math.min(1, Math.abs(dot) / (Math.hypot(p[0], p[1], 1) * Math.hypot(q[0], q[1], 1)))) * 180) / Math.PI
  }
  const parent = found.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
    if (normalAngle(found[i], found[j]) > 6) continue
    const sample = members[j].filter((_, k) => k % 5 === 0)
    const gap = sample.reduce((s, p) => s + Math.abs(p.z - (found[i][0] * p.x + found[i][1] * p.y + found[i][2])), 0) / Math.max(1, sample.length)
    if (gap < 0.25) parent[root(j)] = root(i)
  }
  const groups = new Map<number, LocalPoint[]>()
  members.forEach((ms, i) => {
    const r = root(i)
    const list = groups.get(r)
    if (list) list.push(...ms); else groups.set(r, [...ms])
  })
  const coefs: Coef[] = []
  for (const ms of Array.from(groups.values())) { const c = fitPlane(ms); if (c) coefs.push(c) }

  // ── 4. label grid ────────────────────────────────────────────────────────────
  const votes = new Map<string, Map<number, number>>()
  for (const p of pts) {
    let bestId = -1, bestR = tol * 2
    for (let id = 0; id < coefs.length; id++) { const r = residual(coefs[id], p); if (r < bestR) { bestR = r; bestId = id } }
    if (bestId < 0) continue
    const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL))
    const v = votes.get(k) ?? new Map<number, number>()
    v.set(bestId, (v.get(bestId) || 0) + 1)
    votes.set(k, v)
  }
  const grid = new Map<string, number>()
  for (const [k, v] of Array.from(votes.entries())) grid.set(k, majority(v)![0])
  // close gaps between lidar returns (a cell with ≥3 labelled 4-neighbours)
  for (let pass = 0; pass < 2; pass++) {
    const cand = new Set<string>()
    for (const k of Array.from(grid.keys())) {
      const [i, j] = unkey(k)
      for (const [di, dj] of NEIGHBOURS_4) { const nk = key(i + di, j + dj); if (!grid.has(nk)) cand.add(nk) }
    }
    const add: [string, number][] = []
    for (const k of Array.from(cand)) {
      const [i, j] = unkey(k)
      const cnt = new Map<number, number>()
      let n = 0
      for (const [di, dj] of NEIGHBOURS_4) { const o = grid.get(key(i + di, j + dj)); if (o != null) { n++; cnt.set(o, (cnt.get(o) || 0) + 1) } }
      if (n >= 3) add.push([k, majority(cnt)![0]])
    }
    for (const [k, id] of add) grid.set(k, id)
  }
  // 3×3 majority smoothing
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map(grid)
    for (const [k, id] of Array.from(grid.entries())) {
      const [i, j] = unkey(k)
      const cnt = new Map<number, number>()
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const o = grid.get(key(i + di, j + dj)); if (o != null) cnt.set(o, (cnt.get(o) || 0) + 1) }
      const top = majority(cnt)
      if (top && top[0] !== id && top[1] >= 5) next.set(k, top[0])
    }
    grid.clear()
    for (const [k, v] of Array.from(next.entries())) grid.set(k, v)
  }
  // fold slivers (< 3 m²: vents, dormer noise) into their largest neighbour
  const sizes = new Map<number, number>()
  for (const id of Array.from(grid.values())) sizes.set(id, (sizes.get(id) || 0) + 1)
  const tiny = new Set(Array.from(sizes.entries()).filter(([, n]) => n * CELL * CELL < 3).map(([id]) => id))
  for (let pass = 0; pass < 3 && tiny.size; pass++) {
    for (const [k, id] of Array.from(grid.entries())) {
      if (!tiny.has(id)) continue
      const [i, j] = unkey(k)
      const cnt = new Map<number, number>()
      for (const [di, dj] of NEIGHBOURS_4) { const o = grid.get(key(i + di, j + dj)); if (o != null && !tiny.has(o)) cnt.set(o, (cnt.get(o) || 0) + 1) }
      const top = majority(cnt)
      if (top) grid.set(k, top[0])
    }
  }

  // ── 5a. planes (only those that still own cells), renumbered ──────────────────
  const cellsBy = new Map<number, string[]>()
  for (const [k, id] of Array.from(grid.entries())) { const l = cellsBy.get(id); if (l) l.push(k); else cellsBy.set(id, [k]) }
  const liveIds = Array.from(cellsBy.keys()).sort((m, n) => cellsBy.get(n)!.length - cellsBy.get(m)!.length)
  const renumber = new Map(liveIds.map((old, i) => [old, i]))
  for (const [k, id] of Array.from(grid.entries())) grid.set(k, renumber.get(id)!)
  const planes: LidarPlane[] = liveIds.map((old, id) => {
    const [a, b, c] = coefs[old]
    const pitch = Math.atan(Math.hypot(a, b))
    const flat = cellsBy.get(old)!.length * CELL * CELL
    return {
      id, a, b, c,
      pitchDegrees: (pitch * 180) / Math.PI,
      drainAzimuthDegrees: (((Math.atan2(-a, -b) * 180) / Math.PI) + 360) % 360,
      flatAreaM2: flat,
      slopedAreaM2: flat / Math.cos(pitch),
      eaveM: 0,
      rakeM: 0,
      outline: outlineOfCells(cellsBy.get(old)!),
    }
  })

  // ── 5b. edges between planes ──────────────────────────────────────────────────
  type Sample = { x: number; y: number; ax: number; ay: number; bx: number; by: number }
  const pairSamples = new Map<string, Sample[]>()
  const exterior = new Map<number, { x: number; y: number; nx: number; ny: number }[]>()
  for (const [k, id] of Array.from(grid.entries())) {
    const [i, j] = unkey(k)
    for (const [di, dj] of NEIGHBOURS_4) {
      const o = grid.get(key(i + di, j + dj))
      const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL
      const mx = cx + (di * CELL) / 2, my = cy + (dj * CELL) / 2
      if (o == null) {
        const l = exterior.get(id) ?? []
        l.push({ x: mx, y: my, nx: di, ny: dj })
        exterior.set(id, l)
        continue
      }
      if (o === id || o < id) continue // each shared cell-edge once, from the lower id
      // step 1.5 m into each side — right at the edge the two planes are nearly equal
      const s: Sample = { x: mx, y: my, ax: mx - di * 1.5, ay: my - dj * 1.5, bx: mx + di * 1.5, by: my + dj * 1.5 }
      const pk = `${id}|${o}`
      const l = pairSamples.get(pk) ?? []
      l.push(s)
      pairSamples.set(pk, l)
    }
  }
  const edges: LidarEdge[] = []
  for (const [pk, samples] of Array.from(pairSamples.entries())) {
    if (samples.length < 4) continue // < ~2 m shared
    const [ia, ib] = pk.split('|').map(Number)
    const A = planes[ia], B = planes[ib]
    const gaps = samples.map((q) => Math.abs(zAt(A, q.x, q.y) - zAt(B, q.x, q.y))).sort((m, n) => m - n)
    const medianGap = gaps[Math.floor(gaps.length / 2)]
    let convex = 0, concave = 0
    for (const q of samples) {
      const dA = zAt(B, q.ax, q.ay) - zAt(A, q.ax, q.ay)
      const dB = zAt(A, q.bx, q.by) - zAt(B, q.bx, q.by)
      if (dA > 0.05 && dB > 0.05) convex++
      else if (dA < -0.05 && dB < -0.05) concave++
    }
    // fold line direction: cross product of the plane normals
    // n = (a, b, -1) for each plane; d = nA × nB
    let d = [A.b * -1 - -1 * B.b, -1 * B.a - A.a * -1, A.a * B.b - A.b * B.a]
    const dl = Math.hypot(d[0], d[1])
    if (dl < 1e-6) continue
    d = d.map((v) => v / dl)
    // span along the fold, split wherever the shared boundary breaks for > 1.5 m
    const proj = samples.map((q) => q.x * d[0] + q.y * d[1]).sort((m, n) => m - n)
    let len = 0
    let runStart = proj[0]
    for (let t = 1; t <= proj.length; t++) {
      if (t === proj.length || proj[t] - proj[t - 1] > 1.5) {
        len += proj[t - 1] - runStart + CELL
        if (t < proj.length) runStart = proj[t]
      }
    }
    const cosAng = (A.a * B.a + A.b * B.b + 1) / (Math.hypot(A.a, A.b, 1) * Math.hypot(B.a, B.b, 1))
    const dihedral = (Math.acos(Math.min(1, cosAng)) * 180) / Math.PI
    const edgeSlope = (Math.atan(Math.abs(d[2])) * 180) / Math.PI
    let type: LidarEdgeType
    if (medianGap > 0.35 || dihedral < 8) type = 'step'
    else if (convex >= concave * 2 && convex >= samples.length * 0.4) {
      // A ridge runs level; a hip descends at roughly pitch/√2 — judge against the flatter plane.
      type = edgeSlope < Math.max(3, Math.min(A.pitchDegrees, B.pitchDegrees) * 0.35) ? 'ridge' : 'hip'
    } else if (concave >= convex * 2 && concave >= samples.length * 0.4) type = 'valley'
    else type = 'unknown'
    const sloped = type === 'hip' || type === 'valley' ? len * Math.sqrt(1 + d[2] ** 2) : len
    edges.push({ type, lengthM: sloped, planeA: ia, planeB: ib })
  }

  // No edge-cell area correction: a 0.5 m grid reads a synthetic gable ~6% high, but on
  // real roofs (vs carrier squares, which include the drip-edge overhang the lidar also
  // hits) removing half a cell made the error worse (4.7% → 6%, 2026-09-26). Re-check
  // with `npm run lidar:eval` before adding one.

  // ── 5c. eaves and rakes: exterior cell-edges, by the plane's downslope ───────
  // A cell-edge whose outward normal points downslope is eave; across-slope is rake. Length is
  // the span along the line (split at gaps > 1.5 m), not a count of grid steps — a slightly
  // ragged edge adds steps but not span.
  const span = (vals: number[]) => {
    if (vals.length === 0) return 0
    const v = vals.slice().sort((m, n) => m - n)
    let total = 0
    let start = v[0]
    for (let t = 1; t <= v.length; t++) {
      if (t === v.length || v[t] - v[t - 1] > 1.5) { total += v[t - 1] - start + CELL; if (t < v.length) start = v[t] }
    }
    return total
  }
  for (const [id, segs] of Array.from(exterior.entries())) {
    const pl = planes[id]
    if (pl.pitchDegrees < 2) continue // flat: no eave/rake distinction
    const rad = (pl.drainAzimuthDegrees * Math.PI) / 180
    const down = { x: Math.sin(rad), y: Math.cos(rad) }
    const along = { x: down.y, y: -down.x }
    // Group by side (downslope / upslope / left / right) so opposite eaves don't merge into one span.
    const sides = new Map<string, number[]>()
    for (const s of segs) {
      const dn = s.nx * down.x + s.ny * down.y
      const al = s.nx * along.x + s.ny * along.y
      const side = Math.abs(dn) >= Math.abs(al) ? (dn > 0 ? 'eave+' : 'eave-') : al > 0 ? 'rake+' : 'rake-'
      const pos = side.startsWith('eave') ? s.x * along.x + s.y * along.y : s.x * down.x + s.y * down.y
      const l = sides.get(side) ?? []
      l.push(pos)
      sides.set(side, l)
    }
    const cos = Math.cos((pl.pitchDegrees * Math.PI) / 180)
    for (const [side, vals] of Array.from(sides.entries())) {
      // the upslope 'eave-' side of a lone plane is a ridge/wall line with no neighbour — not an eave
      if (side === 'eave-') continue
      if (side === 'eave+') pl.eaveM += span(vals)
      else pl.rakeM += span(vals) / cos // rakes run up the slope: true length = plan ÷ cos(pitch)
    }
  }

  const sumLf = (t: LidarEdgeType) => Math.round(edges.filter((e) => e.type === t).reduce((s, e) => s + e.lengthM, 0) * M_TO_FT)
  const flatM2 = planes.reduce((s, p) => s + p.flatAreaM2, 0)
  const slopedM2 = planes.reduce((s, p) => s + p.slopedAreaM2, 0)
  return {
    planes,
    edges,
    totals: {
      squares: Math.round((slopedM2 * M2_TO_SQFT) / 10) / 10,
      flatSqft: Math.round(flatM2 * M2_TO_SQFT),
      ridgeLf: sumLf('ridge'),
      hipLf: sumLf('hip'),
      valleyLf: sumLf('valley'),
      eaveLf: Math.round(planes.reduce((s, p) => s + p.eaveM, 0) * M_TO_FT),
      rakeLf: Math.round(planes.reduce((s, p) => s + p.rakeM, 0) * M_TO_FT),
      stepLf: sumLf('step'),
      unknownLf: sumLf('unknown'),
    },
    buildingPoints: pts.length,
    pointsPerM2: Math.round(density * 10) / 10,
  }
}

/** Outer boundary of a set of grid cells, traced and simplified (Douglas–Peucker, 0.35 m). */
function outlineOfCells(cellKeys: string[]): { x: number; y: number }[] {
  const cells = new Set(cellKeys)
  // directed boundary edges with the cell on the left (counter-clockwise)
  const next = new Map<string, string[]>()
  const push = (a: [number, number], b: [number, number]) => {
    const ka = key(a[0], a[1])
    const l = next.get(ka) ?? []
    l.push(key(b[0], b[1]))
    next.set(ka, l)
  }
  for (const k of cellKeys) {
    const [i, j] = unkey(k)
    if (!cells.has(key(i, j - 1))) push([i, j], [i + 1, j])
    if (!cells.has(key(i + 1, j))) push([i + 1, j], [i + 1, j + 1])
    if (!cells.has(key(i, j + 1))) push([i + 1, j + 1], [i, j + 1])
    if (!cells.has(key(i - 1, j))) push([i, j + 1], [i, j])
  }
  // walk every loop; keep the one enclosing the most area (the outer ring)
  let bestLoop: [number, number][] = []
  let bestArea = 0
  const used = new Set<string>()
  for (const start of Array.from(next.keys())) {
    for (const firstTo of next.get(start)!) {
      const ek = `${start}>${firstTo}`
      if (used.has(ek)) continue
      const loop: [number, number][] = [unkey(start)]
      let from = start, to = firstTo
      for (let guard = 0; guard < 100000; guard++) {
        used.add(`${from}>${to}`)
        if (to === start) break
        loop.push(unkey(to))
        const outs = (next.get(to) ?? []).filter((n) => !used.has(`${to}>${n}`))
        if (outs.length === 0) break
        from = to
        to = outs[0]
      }
      let area = 0
      for (let t = 0; t < loop.length; t++) {
        const p = loop[t], q = loop[(t + 1) % loop.length]
        area += p[0] * q[1] - q[0] * p[1]
      }
      if (area / 2 > bestArea) { bestArea = area / 2; bestLoop = loop }
    }
  }
  const pts = bestLoop.map(([i, j]) => ({ x: i * CELL, y: j * CELL }))
  return douglasPeucker(pts, 0.35)
}

function douglasPeucker(ring: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (ring.length < 4) return ring
  const simplify = (pts: { x: number; y: number }[]): { x: number; y: number }[] => {
    if (pts.length < 3) return pts
    const a = pts[0], b = pts[pts.length - 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9
    let maxD = 0, idx = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD <= tol) return [a, b]
    const left = simplify(pts.slice(0, idx + 1))
    return [...left.slice(0, -1), ...simplify(pts.slice(idx))]
  }
  // split the closed ring at its farthest-apart pair so both halves simplify well
  let far = 1, farD = 0
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y)
    if (d > farD) { farD = d; far = i }
  }
  const first = simplify(ring.slice(0, far + 1))
  const second = simplify([...ring.slice(far), ring[0]])
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}
