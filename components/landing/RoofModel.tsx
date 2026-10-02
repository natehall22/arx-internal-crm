/**
 * A hip-roof house built from real geometry in CSS 3D (no WebGL — R3F silently
 * fails to mount in this Next 14 / React 18 setup, and the preview tooling
 * can't screenshot a WebGL layer).
 *
 * Driven entirely by CSS custom properties on an ancestor, so the scroll
 * handler never re-renders React:
 *   --rot   Y rotation (deg)
 *   --draw  0..1  gold ridge/hip measurement lines drawing on
 *   --lift  0..1  roof exploding into shingle / underlayment / deck layers
 */

// Footprint (eave) and rise, in px. Equal-pitch hip roof: every face slopes
// in by D/2 over RISE, so the ridge is W - D long and all four faces share one
// slope length and one pitch angle.
const W = 320
const D = 220
const H = 110
const RISE = 80
const RUN = D / 2
// Rounded so server and client render identical style strings (Node and the
// browser can differ in the last float digit, which breaks hydration).
const SLOPE = Math.round(Math.hypot(RUN, RISE) * 100) / 100
const PITCH = Math.round(((Math.atan2(RUN, RISE) * 180) / Math.PI) * 100) / 100
const OVERHANG = 10

type Face = { ry: number; tz: number; w: number; trap: boolean; shade: number }

const ROOF_FACES: Face[] = [
  { ry: 0, tz: D / 2, w: W, trap: true, shade: 0 },
  { ry: 90, tz: W / 2, w: D, trap: false, shade: 0.24 },
  { ry: 180, tz: D / 2, w: W, trap: true, shade: 0.4 },
  { ry: 270, tz: W / 2, w: D, trap: false, shade: 0.12 },
]

// Shingles on top, then underlayment, then deck. `lift` is how far each layer
// rises at --lift: 1; `sink` tucks the lower layers just under the one above
// so they stay hidden (and never z-fight) until the roof explodes.
const LAYERS = [
  {
    key: 'deck',
    lift: 0,
    sink: 6,
    bg: 'repeating-linear-gradient(90deg, #C9A06A 0 78px, #B98E58 78px 80px), #C9A06A',
  },
  {
    key: 'underlayment',
    lift: 48,
    sink: 3,
    bg: 'repeating-linear-gradient(180deg, #E4DED2 0 30px, #CFC7B8 30px 31px), #E4DED2',
  },
  {
    key: 'shingles',
    lift: 100,
    sink: 0,
    bg: 'repeating-linear-gradient(180deg, transparent 0 10px, rgba(0,0,0,0.32) 10px 11px), repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 18px, transparent 18px 36px), #3B3833',
  },
] as const

const RIDGE_INSET = RUN // the hip runs in by D/2 at each end

function facePath(f: Face) {
  return f.trap
    ? `M0,${SLOPE} L${RIDGE_INSET},0 L${f.w - RIDGE_INSET},0 L${f.w},${SLOPE}`
    : `M0,${SLOPE} L${f.w / 2},0 L${f.w},${SLOPE}`
}

function RoofLayer({ layer }: { layer: (typeof LAYERS)[number] }) {
  const top = layer.key === 'shingles'
  return (
    <>
      {ROOF_FACES.map((f) => (
        <div
          key={`${layer.key}-${f.ry}`}
          className="absolute"
          style={{
            left: -f.w / 2,
            top: -SLOPE,
            width: f.w,
            height: SLOPE,
            transformOrigin: '50% 100%',
            transform: `translateY(calc(${layer.sink}px - var(--lift, 0) * ${layer.lift}px)) rotateY(${f.ry}deg) translateZ(${f.tz}px) rotateX(${PITCH}deg)`,
            clipPath: f.trap
              ? `polygon(${RIDGE_INSET}px 0, ${f.w - RIDGE_INSET}px 0, 100% 100%, 0 100%)`
              : 'polygon(50% 0, 100% 100%, 0 100%)',
            background: layer.bg,
            opacity: top ? 1 : 'min(1, calc(var(--lift, 0) * 6))',
          }}
        >
          <div className="absolute inset-0" style={{ background: `rgba(10,9,8,${f.shade})` }} />
          {top && (
            <svg
              className="absolute inset-0 overflow-visible"
              width={f.w}
              height={SLOPE}
              viewBox={`0 0 ${f.w} ${SLOPE}`}
              aria-hidden="true"
            >
              <path
                d={facePath(f)}
                fill="none"
                stroke="#E2BF73"
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray="1 1"
                style={{ strokeDashoffset: 'calc(1 - var(--draw, 0))' }}
              />
            </svg>
          )}
        </div>
      ))}
    </>
  )
}

function Window({ x, w = 46 }: { x: number; w?: number }) {
  return (
    <div
      className="absolute rounded-[3px] border-[3px] border-[#F7F2E8]"
      style={{
        left: x,
        top: 30,
        width: w,
        height: 46,
        background: 'linear-gradient(135deg, #4A4741 0%, #2A2825 55%, #6E6248 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
      }}
    >
      <div className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-[#F7F2E8]" />
    </div>
  )
}

const WALLS: { ry: number; w: number; tz: number; shade: number; detail: 'front' | 'side' | 'back' }[] = [
  { ry: 0, w: W - OVERHANG * 2, tz: D / 2 - OVERHANG, shade: 0, detail: 'front' },
  { ry: 90, w: D - OVERHANG * 2, tz: W / 2 - OVERHANG, shade: 0.16, detail: 'side' },
  { ry: 180, w: W - OVERHANG * 2, tz: D / 2 - OVERHANG, shade: 0.3, detail: 'back' },
  { ry: 270, w: D - OVERHANG * 2, tz: W / 2 - OVERHANG, shade: 0.08, detail: 'side' },
]

// Walls start a few px above the eave line so they meet the roof's underside
// (the roof is that high above the inset wall plane) instead of leaving a gap.
const WALL_TOP = -Math.round((OVERHANG * RISE) / RUN)

export default function RoofModel() {
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{
        transformStyle: 'preserve-3d',
        transform: 'translateY(-10px) rotateX(-24deg) rotateY(var(--rot, -32deg))',
      }}
      aria-hidden="true"
    >
      {/* blueprint ground */}
      <div
        className="absolute"
        style={{
          left: -420,
          top: -320,
          width: 840,
          height: 640,
          transform: `translateY(${H}px) rotateX(90deg)`,
          background:
            'repeating-linear-gradient(0deg, rgba(226,191,115,0.13) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(226,191,115,0.13) 0 1px, transparent 1px 40px)',
          WebkitMaskImage: 'radial-gradient(closest-side, #000 30%, transparent)',
          maskImage: 'radial-gradient(closest-side, #000 30%, transparent)',
        }}
      />
      {/* contact shadow */}
      <div
        className="absolute"
        style={{
          left: -230,
          top: -170,
          width: 460,
          height: 340,
          transform: `translateY(${H - 1}px) rotateX(90deg)`,
          background: 'radial-gradient(closest-side, rgba(0,0,0,0.55), transparent)',
        }}
      />

      {WALLS.map((wall) => (
        <div
          key={wall.ry}
          className="absolute"
          style={{
            left: -wall.w / 2,
            top: WALL_TOP,
            width: wall.w,
            height: H - WALL_TOP,
            transformOrigin: '50% 0',
            transform: `rotateY(${wall.ry}deg) translateZ(${wall.tz}px)`,
            background:
              'repeating-linear-gradient(180deg, transparent 0 13px, rgba(33,31,29,0.07) 13px 14px), #EFE8DA',
          }}
        >
          {wall.detail === 'front' && (
            <>
              <Window x={34} />
              <Window x={wall.w - 34 - 46} />
              <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-[3px] border-[3px] border-b-0 border-[#F7F2E8]"
                style={{ width: 44, height: 78, background: '#5B4A33' }}
              >
                <div className="absolute right-2 top-1/2 h-1.5 w-1.5 rounded-full bg-[#E2BF73]" />
              </div>
            </>
          )}
          {wall.detail === 'side' && <Window x={wall.w / 2 - 23} />}
          {wall.detail === 'back' && (
            <>
              <Window x={60} />
              <Window x={wall.w - 60 - 46} />
            </>
          )}
          <div className="absolute inset-0" style={{ background: `rgba(10,9,8,${wall.shade})` }} />
        </div>
      ))}

      {LAYERS.map((layer) => (
        <RoofLayer key={layer.key} layer={layer} />
      ))}
    </div>
  )
}
