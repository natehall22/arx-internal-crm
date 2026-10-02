/**
 * The landing-page house, rendered with plain three.js (no React wrapper —
 * @react-three/fiber silently failed to mount in this Next 14.1 / React 18.2
 * app). Loaded with a dynamic import so three stays out of the main bundle.
 *
 * Everything is procedural: geometry is a real equal-pitch hip roof, and the
 * shingle / siding / deck / underlayment / grass textures are drawn to canvases
 * at startup, so there are no asset files to ship or license.
 *
 * The scroll story drives it through `progress` (read every frame, never via
 * React state): `p` moves the camera, `pin` drops the lead pin, `draw` traces
 * the gold ridge + hip lines, `lift` explodes the roof into its layers.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type StoryProgress = { p: number; draw: number; lift: number; pin: number }

// ── Dimensions (metres) ────────────────────────────────────────────────────
const W = 12 // wall footprint, x
const D = 8 //                  z
const H = 3 // wall height
const OH = 0.45 // eave overhang
const PITCH = 8 / 12
const EW = W + 2 * OH
const ED = D + 2 * OH
const EAVE_Y = H - OH * PITCH // eave sits below the wall plate by the overhang's drop
const RIDGE_Y = EAVE_Y + (ED / 2) * PITCH
const RIDGE_HALF = (EW - ED) / 2

const GOLD = 0xe2bf73

// ── Small deterministic RNG so textures look the same on every load ────────
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function toTexture(c: HTMLCanvasElement, metres: [number, number], color = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / metres[0], 1 / metres[1])
  t.anisotropy = aniso
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, r: () => number, light: string, dark: string, size = 1.6) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = r() < 0.5 ? light : dark
    const s = size * (0.5 + r())
    ctx.fillRect(r() * w, r() * h, s, s)
  }
}

// Architectural (laminated) shingles: random-width tabs per course, offset
// course to course, a shadow under each butt edge, and granule speckle.
// Tile = 2m × 2m, 14 courses (≈0.14m exposure).
function shingleTextures(aniso: number) {
  const S = 1024
  const [c, ctx] = makeCanvas(S)
  const [b, bctx] = makeCanvas(S)
  const r = rng(7)
  const rows = 14
  const rowH = S / rows
  const shades = ['#3a3734', '#2f2d2a', '#45413c', '#36332f', '#4d4842', '#2a2826']
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, S, S)
  for (let row = 0; row < rows; row++) {
    const y = row * rowH
    // bump: each course rises from the butt above it (drawn first so slots sit on top)
    const bg = bctx.createLinearGradient(0, y, 0, y + rowH)
    bg.addColorStop(0, '#303030')
    bg.addColorStop(0.3, '#8a8a8a')
    bg.addColorStop(1, '#b0b0b0')
    bctx.fillStyle = bg
    bctx.fillRect(0, y, S, rowH)
    let x = -r() * 160
    while (x < S) {
      const w = 60 + r() * 150
      const shade = shades[Math.floor(r() * shades.length)]
      ctx.fillStyle = shade
      ctx.fillRect(x, y, w, rowH)
      if (x + w > S) ctx.fillRect(x - S, y, w, rowH) // wrap so the tile repeats seamlessly
      // laminated "dragon tooth" darker lower band on some tabs
      if (r() < 0.55) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        const bandH = rowH * (0.3 + r() * 0.25)
        ctx.fillRect(x, y + rowH - bandH, w, bandH)
        if (x + w > S) ctx.fillRect(x - S, y + rowH - bandH, w, bandH)
      }
      // slot between tabs
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(x + w - 2, y + rowH * 0.25, 3, rowH * 0.75)
      bctx.fillStyle = '#4a4a4a'
      bctx.fillRect(x + w - 2, y + rowH * 0.25, 3, rowH * 0.75)
      if (x + w > S) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(x + w - 2 - S, y + rowH * 0.25, 3, rowH * 0.75)
      }
      x += w
    }
    // shadow cast by the course above onto the top of this one
    const g = ctx.createLinearGradient(0, y, 0, y + rowH * 0.32)
    g.addColorStop(0, 'rgba(0,0,0,0.6)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, y, S, rowH * 0.32)
  }
  speckle(ctx, S, S, 90000, r, 'rgba(255,245,225,0.10)', 'rgba(0,0,0,0.22)', 1.4)
  speckle(bctx, S, S, 60000, r, 'rgba(255,255,255,0.18)', 'rgba(0,0,0,0.18)', 1.4)
  return { map: toTexture(c, [2, 2], true, aniso), bump: toTexture(b, [2, 2], false, aniso) }
}

// Lap siding, warm white: 11 boards per 2m with a shadow under each butt.
function sidingTextures(aniso: number) {
  const S = 512
  const [c, ctx] = makeCanvas(S)
  const [b, bctx] = makeCanvas(S)
  const r = rng(11)
  const boards = 11
  const bh = S / boards
  for (let i = 0; i < boards; i++) {
    const y = i * bh
    const g = ctx.createLinearGradient(0, y, 0, y + bh)
    g.addColorStop(0, '#E9E2D2')
    g.addColorStop(0.15, '#F3EEE3')
    g.addColorStop(1, '#E6DECC')
    ctx.fillStyle = g
    ctx.fillRect(0, y, S, bh)
    ctx.fillStyle = 'rgba(70,58,40,0.28)'
    ctx.fillRect(0, y, S, 2.5)
    const bg = bctx.createLinearGradient(0, y, 0, y + bh)
    bg.addColorStop(0, '#202020')
    bg.addColorStop(0.12, '#909090')
    bg.addColorStop(1, '#d8d8d8')
    bctx.fillStyle = bg
    bctx.fillRect(0, y, S, bh)
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(120,100,70,0.05)' : 'rgba(255,255,255,0.08)'
    ctx.fillRect(r() * S, r() * S, 30 + r() * 120, 1)
  }
  return { map: toTexture(c, [2, 2], true, aniso), bump: toTexture(b, [2, 2], false, aniso) }
}

// OSB roof deck, 2.44 × 1.22 m sheets.
function osbTexture(aniso: number) {
  const [c, ctx] = makeCanvas(1024, 512)
  const r = rng(23)
  ctx.fillStyle = '#C9A46B'
  ctx.fillRect(0, 0, 1024, 512)
  const tones = ['#B38A52', '#D9B985', '#C0975C', '#E2C795', '#A97F48']
  for (let i = 0; i < 5000; i++) {
    ctx.save()
    ctx.translate(r() * 1024, r() * 512)
    ctx.rotate(r() * Math.PI)
    ctx.fillStyle = tones[Math.floor(r() * tones.length)]
    ctx.globalAlpha = 0.55
    ctx.fillRect(-14, -3, 28 + r() * 20, 5 + r() * 4)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(60,40,20,0.55)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, 1021, 509)
  return toTexture(c, [2.44, 1.22], true, aniso)
}

// Synthetic underlayment: light grey with printed overlap lines.
function underlaymentTexture(aniso: number) {
  const [c, ctx] = makeCanvas(512)
  const r = rng(31)
  ctx.fillStyle = '#C9CDD0'
  ctx.fillRect(0, 0, 512, 512)
  speckle(ctx, 512, 512, 9000, r, 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.06)', 1.2)
  ctx.fillStyle = '#6E8597'
  ctx.fillRect(0, 40, 512, 3)
  ctx.fillRect(0, 296, 512, 3)
  ctx.fillStyle = 'rgba(80,95,110,0.35)'
  for (let x = 0; x < 512; x += 64) ctx.fillRect(x, 0, 1, 512)
  return toTexture(c, [2, 2], true, aniso)
}

function grassTexture(aniso: number) {
  const S = 512
  const [c, ctx] = makeCanvas(S)
  const r = rng(43)
  ctx.fillStyle = '#4C6A36'
  ctx.fillRect(0, 0, S, S)
  const greens = ['#5B7C3F', '#3F5A2C', '#6A8A48', '#4A6633', '#56743B', '#36502A']
  for (let i = 0; i < 40000; i++) {
    ctx.strokeStyle = greens[Math.floor(r() * greens.length)]
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1
    const x = r() * S
    const y = r() * S
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  return toTexture(c, [3, 3], true, aniso)
}

function concreteTexture(aniso: number, jointEvery: number) {
  const [c, ctx] = makeCanvas(512)
  const r = rng(57)
  ctx.fillStyle = '#BDB8AE'
  ctx.fillRect(0, 0, 512, 512)
  speckle(ctx, 512, 512, 30000, r, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.08)', 1.5)
  ctx.fillStyle = 'rgba(60,55,48,0.45)'
  ctx.fillRect(0, 0, 512, 3)
  return toTexture(c, [jointEvery, jointEvery], true, aniso)
}

function radialAlpha(inner = 0.55) {
  const [c, ctx] = makeCanvas(256)
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, '#fff')
  g.addColorStop(inner, '#fff')
  g.addColorStop(1, '#000')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

// ── Geometry helpers ───────────────────────────────────────────────────────

/** A flat roof face (convex polygon, eave edge first) with UVs in metres:
 *  u along the eave, v up the slope — so shingle courses run parallel to the eave. */
function roofFace(pts: THREE.Vector3[]) {
  const [A, B] = pts
  const e = new THREE.Vector3().subVectors(B, A).normalize()
  const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(pts[2], A)).normalize()
  const up = new THREE.Vector3().crossVectors(n, e)
  const pos: number[] = []
  const uv: number[] = []
  const nor: number[] = []
  const push = (P: THREE.Vector3) => {
    pos.push(P.x, P.y, P.z)
    const d = new THREE.Vector3().subVectors(P, A)
    uv.push(d.dot(e), d.dot(up))
    nor.push(n.x, n.y, n.z)
  }
  for (let i = 1; i < pts.length - 1; i++) {
    push(pts[0])
    push(pts[i])
    push(pts[i + 1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return g
}

/** PlaneGeometry whose UVs are in metres, so one tiled texture fits any wall. */
function meterPlane(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h)
  return g
}

/** Cylinder from a to b; `scale.y` is the 0..1 drawn fraction once set. */
function beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, segments = 10) {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, segments)
  geo.translate(0, 0.5, 0)
  const m = new THREE.Mesh(geo, mat)
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  m.position.copy(a)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  m.scale.set(1, len, 1)
  m.userData.len = len
  return m
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// ── Camera choreography ────────────────────────────────────────────────────
// Spherical camera around a target; one key per story beat.
type Key = { at: number; az: number; el: number; dist: number; ty: number }
const deg = Math.PI / 180
const KEYS: Key[] = [
  { at: 0.0, az: 38 * deg, el: 20 * deg, dist: 36, ty: 2.6 }, // hero 3/4
  { at: 0.3, az: 12 * deg, el: 9 * deg, dist: 27, ty: 2.2 }, // knock: street level, front
  { at: 0.57, az: -28 * deg, el: 56 * deg, dist: 29, ty: 3.6 }, // measure: high, over the roof
  { at: 0.84, az: -62 * deg, el: 24 * deg, dist: 34, ty: 4.2 }, // build: exploded 3/4
  { at: 1.0, az: -74 * deg, el: 22 * deg, dist: 35, ty: 4.2 },
]
const smooth = (t: number) => t * t * (3 - 2 * t)
function sampleKeys(p: number) {
  let i = 0
  while (i < KEYS.length - 2 && p > KEYS[i + 1].at) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = smooth(Math.min(1, Math.max(0, (p - a.at) / (b.at - a.at))))
  const mix = (x: number, y: number) => x + (y - x) * t
  return { az: mix(a.az, b.az), el: mix(a.el, b.el), dist: mix(a.dist, b.dist), ty: mix(a.ty, b.ty) }
}

// ── Mount ──────────────────────────────────────────────────────────────────

export function mountHouseScene(
  host: HTMLElement,
  progress: { current: StoryProgress },
  onFirstFrame: () => void
): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  if (!renderer.getContext()) throw new Error('no webgl context')
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  host.appendChild(canvas)

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTex
  scene.environmentIntensity = 0.45

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 300)

  // Lights: warm low sun with soft shadows + sky/ground fill.
  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x4a4030, 0.9))
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.0)
  sun.position.set(14, 20, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 70 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 4
  scene.add(sun)

  // Materials
  const shingle = shingleTextures(aniso)
  const siding = sidingTextures(aniso)
  const mShingle = new THREE.MeshStandardMaterial({ map: shingle.map, bumpMap: shingle.bump, bumpScale: 2.2, roughness: 0.92, side: THREE.DoubleSide })
  const mUnder = new THREE.MeshStandardMaterial({ map: underlaymentTexture(aniso), color: 0xb4bcc2, roughness: 0.75, side: THREE.DoubleSide })
  const mDeck = new THREE.MeshStandardMaterial({ map: osbTexture(aniso), roughness: 0.85, side: THREE.DoubleSide })
  const mSiding = new THREE.MeshStandardMaterial({ map: siding.map, bumpMap: siding.bump, bumpScale: 1.6, roughness: 0.82 })
  const mTrim = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.55 })
  const mGutter = new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.4, metalness: 0.1 })
  const mCap = new THREE.MeshStandardMaterial({ color: 0x2c2a27, roughness: 0.95 })
  const mShutter = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6 })
  const mDoor = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.45 })
  const mBrass = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.25, metalness: 0.9 })
  const mGlass = new THREE.MeshPhysicalMaterial({ color: 0x1c2630, roughness: 0.04, metalness: 0, clearcoat: 1, envMapIntensity: 2.2 })
  const mFoundation = new THREE.MeshStandardMaterial({ map: concreteTexture(aniso, 2), color: 0xa9a49a, roughness: 0.95 })
  const mConcrete = new THREE.MeshStandardMaterial({ map: concreteTexture(aniso, 3), color: 0xb3ada3, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 })
  const mMulch = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 })
  const mLeaf = new THREE.MeshStandardMaterial({ color: 0x3e5c2c, roughness: 0.95 })
  const mLeafDark = new THREE.MeshStandardMaterial({ color: 0x2f4823, roughness: 0.95 })
  const mGold = new THREE.MeshStandardMaterial({ color: 0xd8a640, emissive: 0xb8862c, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.5 })
  const mPin = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.28, metalness: 0.65, transparent: true })
  const mRing = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, depthWrite: false })

  const house = new THREE.Group()
  scene.add(house)

  // Ground: grass disc that fades to transparent at the edge so it floats on
  // the page background instead of ending in a hard circle.
  const grassMap = grassTexture(aniso)
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(17, 96),
    new THREE.MeshStandardMaterial({ map: grassMap, color: 0xaab398, alphaMap: radialAlpha(0.45), transparent: true, roughness: 1, depthWrite: false })
  )
  // Tile the grass via its own repeat — NOT by scaling the UVs, which the
  // alpha fade shares (scaled UVs clamp it to fully transparent).
  grassMap.repeat.set(34 / 3, 34 / 3)
  lawn.rotation.x = -Math.PI / 2
  lawn.receiveShadow = true
  scene.add(lawn)

  // Soft contact occlusion under the house.
  const ao = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 4, D + 4),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: radialAlpha(0.35), transparent: true, opacity: 0.45, depthWrite: false })
  )
  ao.rotation.x = -Math.PI / 2
  ao.position.y = 0.012
  scene.add(ao)

  // Driveway + walk
  const drive = new THREE.Mesh(meterPlane(3.4, 8), mConcrete)
  drive.rotation.x = -Math.PI / 2
  drive.position.set(4.6, 0.02, D / 2 + 4)
  drive.receiveShadow = true
  scene.add(drive)
  const walk = new THREE.Mesh(meterPlane(1.3, 4.2), mConcrete)
  walk.rotation.x = -Math.PI / 2
  walk.position.set(0, 0.02, D / 2 + 1.1 + 2.1)
  walk.receiveShadow = true
  scene.add(walk)
  const mulch = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, 1.5), mMulch)
  mulch.rotation.x = -Math.PI / 2
  mulch.position.set(0, 0.018, D / 2 + 0.75)
  mulch.receiveShadow = true
  scene.add(mulch)

  // Foundation
  house.add(box(W + 0.12, 0.42, D + 0.12, mFoundation, 0, 0.21, 0))

  // Walls: four meter-UV planes so siding courses line up on every side.
  const walls: { w: number; ry: number; x: number; z: number }[] = [
    { w: W, ry: 0, x: 0, z: D / 2 },
    { w: D, ry: Math.PI / 2, x: W / 2, z: 0 },
    { w: W, ry: Math.PI, x: 0, z: -D / 2 },
    { w: D, ry: -Math.PI / 2, x: -W / 2, z: 0 },
  ]
  const wallGroups = walls.map((wl) => {
    const g = new THREE.Group()
    g.position.set(wl.x, 0, wl.z)
    g.rotation.y = wl.ry
    const plane = new THREE.Mesh(meterPlane(wl.w, H - 0.4), mSiding)
    plane.position.y = 0.4 + (H - 0.4) / 2
    plane.castShadow = true
    plane.receiveShadow = true
    g.add(plane)
    // corner boards
    for (const sx of [-1, 1]) g.add(box(0.14, H - 0.4, 0.05, mTrim, sx * (wl.w / 2 - 0.07), 0.4 + (H - 0.4) / 2, 0.025))
    house.add(g)
    return g
  })

  const addWindow = (g: THREE.Group, x: number, y: number, w: number, h: number, shutters: boolean) => {
    const t = 0.11
    g.add(box(w + 2 * t, t, 0.08, mTrim, x, y + h / 2 + t / 2, 0.04))
    g.add(box(w + 2 * t + 0.12, 0.07, 0.16, mTrim, x, y - h / 2 - 0.035, 0.08)) // sill
    for (const sx of [-1, 1]) g.add(box(t, h, 0.08, mTrim, x + sx * (w / 2 + t / 2), y, 0.04))
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mGlass)
    glass.position.set(x, y, 0.012)
    g.add(glass)
    g.add(box(0.045, h, 0.03, mTrim, x, y, 0.03))
    g.add(box(w, 0.045, 0.03, mTrim, x, y + h * 0.08, 0.03))
    if (shutters) for (const sx of [-1, 1]) g.add(box(0.42, h + 0.1, 0.05, mShutter, x + sx * (w / 2 + t + 0.25), y, 0.03))
  }
  const [front, right, back, left] = wallGroups
  addWindow(front, -3.6, 1.75, 1.15, 1.35, true)
  addWindow(front, 3.4, 1.75, 1.15, 1.35, true)
  addWindow(right, 0, 1.75, 1.0, 1.3, false)
  addWindow(left, -1.3, 1.75, 1.0, 1.3, false)
  addWindow(left, 1.6, 1.75, 1.0, 1.3, false)
  addWindow(back, -2.5, 1.75, 1.0, 1.3, false)
  addWindow(back, 2.5, 1.75, 1.0, 1.3, false)

  // Front door + trim + step + porch light
  front.add(box(1.02, 2.15, 0.07, mDoor, 0, 0.42 + 2.15 / 2, 0.035))
  front.add(box(1.26, 0.12, 0.09, mTrim, 0, 0.42 + 2.21, 0.045))
  for (const sx of [-1, 1]) front.add(box(0.12, 2.21, 0.09, mTrim, sx * 0.57, 0.42 + 2.21 / 2, 0.045))
  front.add(box(0.07, 0.07, 0.06, mBrass, 0.36, 1.45, 0.1))
  for (const py of [1.0, 1.75]) front.add(box(0.62, 0.55, 0.02, new THREE.MeshStandardMaterial({ color: 0x7d6235, roughness: 0.5 }), 0, py + 0.42 - 0.35, 0.075))
  house.add(box(2.0, 0.2, 1.1, mFoundation, 0, 0.1, D / 2 + 0.55))
  house.add(box(1.5, 0.2, 0.6, mFoundation, 0, 0.3, D / 2 + 0.3))

  // Soffits, fascia, gutters, downspouts (stay put when the roof explodes).
  const fy = EAVE_Y - 0.08
  for (const sz of [-1, 1]) {
    house.add(box(EW, 0.04, OH, mTrim, 0, EAVE_Y - 0.02, sz * (D / 2 + OH / 2)))
    house.add(box(EW + 0.04, 0.22, 0.04, mTrim, 0, fy, sz * (ED / 2 + 0.02)))
    house.add(box(EW + 0.2, 0.13, 0.13, mGutter, 0, fy - 0.02, sz * (ED / 2 + 0.11)))
  }
  for (const sx of [-1, 1]) {
    house.add(box(OH, 0.04, D, mTrim, sx * (W / 2 + OH / 2), EAVE_Y - 0.02, 0))
    house.add(box(0.04, 0.22, ED + 0.04, mTrim, sx * (EW / 2 + 0.02), fy, 0))
    house.add(box(0.13, 0.13, ED + 0.2, mGutter, sx * (EW / 2 + 0.11), fy - 0.02, 0))
    for (const sz of [-1, 1]) {
      const dx = sx * (W / 2 - 0.3)
      house.add(box(0.09, EAVE_Y - 0.1, 0.09, mGutter, dx, (EAVE_Y - 0.1) / 2, sz * (D / 2 + 0.07)))
      house.add(box(0.09, 0.09, OH + 0.1, mGutter, dx, fy - 0.06, sz * (D / 2 + OH / 2 + 0.05)))
    }
  }

  // Roof — three identical hip shells (deck, underlayment, shingles).
  const c = {
    fl: new THREE.Vector3(-EW / 2, EAVE_Y, ED / 2),
    fr: new THREE.Vector3(EW / 2, EAVE_Y, ED / 2),
    br: new THREE.Vector3(EW / 2, EAVE_Y, -ED / 2),
    bl: new THREE.Vector3(-EW / 2, EAVE_Y, -ED / 2),
    r0: new THREE.Vector3(-RIDGE_HALF, RIDGE_Y, 0),
    r1: new THREE.Vector3(RIDGE_HALF, RIDGE_Y, 0),
  }
  const faces = [
    [c.fl, c.fr, c.r1, c.r0],
    [c.fr, c.br, c.r1],
    [c.br, c.bl, c.r0, c.r1],
    [c.bl, c.fl, c.r0],
  ]
  const shell = (mat: THREE.Material, y: number) => {
    const g = new THREE.Group()
    g.position.y = y
    for (const f of faces) {
      const m = new THREE.Mesh(roofFace(f), mat)
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
    }
    return g
  }
  const deck = shell(mDeck, -0.1)
  const under = shell(mUnder, -0.05)
  const shingles = shell(mShingle, 0)
  house.add(deck, under, shingles)

  // Ridge + hip caps and the gold measurement lines riding on them.
  const edges: [THREE.Vector3, THREE.Vector3][] = [
    [c.fl, c.r0],
    [c.fr, c.r1],
    [c.br, c.r1],
    [c.bl, c.r0],
    [c.r0, c.r1],
  ]
  const lift = (v: THREE.Vector3, dy: number) => v.clone().add(new THREE.Vector3(0, dy, 0))
  const lines: THREE.Mesh[] = []
  for (const [a, b] of edges) {
    const cap = beam(lift(a, 0.02), lift(b, 0.02), 0.11, mCap, 8)
    cap.castShadow = true
    shingles.add(cap)
    const ln = beam(lift(a, 0.14), lift(b, 0.14), 0.045, mGold, 10)
    lines.push(ln)
    shingles.add(ln)
  }
  const nodes = [c.fl, c.fr, c.br, c.bl, c.r0, c.r1].map((v) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mGold)
    s.position.copy(lift(v, 0.14))
    shingles.add(s)
    return s
  })

  // Landscaping: shrubs along the front bed.
  const r = rng(99)
  const bush = (x: number, z: number, s: number, mat: THREE.Material) => {
    const geo = new THREE.IcosahedronGeometry(1, 3)
    const p = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (r() - 0.5) * 0.18
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.82, p.getZ(i) * k)
    }
    geo.computeVertexNormals()
    const m = new THREE.Mesh(geo, mat)
    m.scale.setScalar(s)
    m.position.set(x, s * 0.7, z)
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
  }
  for (const [x, s] of [[-5.3, 0.62], [-4.3, 0.5], [-2.5, 0.58], [2.4, 0.55], [5.4, 0.6]] as const) bush(x, D / 2 + 0.75, s, r() < 0.5 ? mLeaf : mLeafDark)

  // Lead pin + pulse ring on the front lawn.
  const pin = new THREE.Group()
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 20), mPin)
  head.position.y = 1.55
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.43, 1.25, 32), mPin)
  tip.rotation.x = Math.PI
  tip.position.y = 0.72
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshStandardMaterial({ color: 0x1a1917, roughness: 0.4 }))
  dot.position.set(0, 1.58, 0.36)
  for (const m of [head, tip]) m.castShadow = true
  pin.add(head, tip, dot)
  pin.position.set(-3.2, 0, D / 2 + 4.2)
  scene.add(pin)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 48), mRing)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(pin.position.x, 0.03, pin.position.z)
  scene.add(ring)

  // ── Sizing / visibility ──────────────────────────────────────────────────
  let distMul = 1
  const resize = () => {
    const w = host.clientWidth
    const h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // Narrow (portrait) frames and phone-width stages need the camera further
    // out to keep the whole roof in view, especially in the overhead shot.
    distMul = (camera.aspect < 1.25 ? Math.min(2, 1.25 / camera.aspect) : 1) * (w < 520 ? 1.2 : 1)
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(host)

  let visible = true
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
  io.observe(host)

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cur = { ...sampleKeys(progress.current.p) }
  const clock = new THREE.Clock()
  let first = true
  let raf = 0

  const step = () => {
    const t = clock.getElapsedTime()
    const pr = progress.current
    const k = sampleKeys(pr.p)
    const ease = reduced || first ? 1 : 0.075
    cur.az += (k.az - cur.az) * ease
    cur.el += (k.el - cur.el) * ease
    cur.dist += (k.dist - cur.dist) * ease
    cur.ty += (k.ty - cur.ty) * ease
    const az = cur.az + (reduced ? 0 : Math.sin(t * 0.22) * 0.05)
    const dist = cur.dist * distMul
    camera.position.set(
      dist * Math.cos(cur.el) * Math.sin(az),
      cur.ty + dist * Math.sin(cur.el),
      dist * Math.cos(cur.el) * Math.cos(az)
    )
    camera.lookAt(0, cur.ty, 0)

    // Explode: shingles rise furthest, underlayment half as far, deck stays.
    const L = smooth(pr.lift)
    shingles.position.y = L * 2.8
    under.position.y = -0.05 + L * 1.4

    // Measurement lines draw on (hips first, ridge last).
    lines.forEach((ln, i) => {
      const local = i < 4 ? Math.min(1, pr.draw / 0.75) : Math.max(0, (pr.draw - 0.6) / 0.4)
      ln.visible = local > 0.001
      ln.scale.y = ln.userData.len * Math.max(0.001, local)
    })
    nodes.forEach((n) => (n.visible = pr.draw > 0.02))

    // Pin drops in and bobs; ring pulses while it's up.
    const pinT = smooth(pr.pin)
    pin.visible = pinT > 0.01
    mPin.opacity = pinT
    pin.position.y = (1 - pinT) * 7 + (reduced ? 0 : Math.sin(t * 2.6) * 0.12 * pinT)
    pin.rotation.y = reduced ? 0 : Math.sin(t * 0.8) * 0.4
    const pulse = reduced ? 0.5 : (t * 0.6) % 1
    ring.visible = pinT > 0.01
    ring.scale.setScalar(1 + pulse * 3.5)
    mRing.opacity = pinT * (1 - pulse) * 0.8

    renderer.render(scene, camera)
    if (first) {
      first = false
      onFirstFrame()
    }
  }
  const loop = () => {
    raf = requestAnimationFrame(loop)
    if (visible) step()
  }
  // First frame synchronously, so the house shows even if the tab mounts in
  // the background (rAF doesn't tick until the page is visible).
  step()
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    io.disconnect()
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose()
        mat.dispose()
      }
    })
    envTex.dispose()
    pmrem.dispose()
    renderer.dispose()
    canvas.remove()
  }
}
