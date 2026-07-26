/* On-brand mock product UIs for the marketing page. Demo data only — no real
   customer records — because this page is public. */

function Dots() {
  return (
    <span className="flex gap-1.5" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full bg-[#E1D6BE]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#E1D6BE]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#E1D6BE]" />
    </span>
  )
}

function BrowserFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E7DECB] bg-white shadow-2xl shadow-[#211F1D]/12">
      <div className="flex items-center gap-3 border-b border-[#F0E9D9] bg-[#FAF6EE] px-4 py-2.5">
        <Dots />
        <span className="ml-1 truncate rounded-md border border-[#EFE8D7] bg-white px-3 py-1 text-[11px] font-medium text-[#8A8272]">
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}

/* ------------------------------ Pipeline ------------------------------- */

const pipelineRows = [
  { label: 'New roof claim', owner: 'Inside sales', status: 'Qualified', value: '$18.4k', dot: '#B0904E' },
  { label: 'Storm follow-up', owner: 'Setter team', status: 'Booked', value: '$11.9k', dot: '#7C8A5A' },
  { label: 'Signed install', owner: 'Operations', status: 'Ready', value: '$24.7k', dot: '#211F1D' },
]

const flowSteps = ['Lead', 'Visit', 'Scope', 'Contract', 'Packet', 'Install']

export function PipelineShot() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#E7DECB] bg-white shadow-2xl shadow-[#211F1D]/15">
      <div className="flex items-center gap-3 border-b border-[#F0E9D9] bg-[#FAF6EE] px-4 py-3">
        <Dots />
        <span className="ml-1 text-xs font-medium text-[#8A8272]">ARX — Job pipeline</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#B0904E]/12 px-2.5 py-1 text-[11px] font-semibold text-[#8A6D3B]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7C8A5A]" />
          Live
        </span>
      </div>

      <div className="flex items-center gap-1 overflow-hidden border-b border-[#F0E9D9] px-4 py-2.5">
        {flowSteps.map((step, i) => (
          <div key={step} className="flex items-center gap-1">
            <span className={`text-[11px] font-semibold ${i === 2 ? 'text-[#B0904E]' : 'text-[#A7A08F]'}`}>{step}</span>
            {i < flowSteps.length - 1 && <span className="text-[#D8CFB9]" aria-hidden="true">›</span>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 divide-x divide-[#F0E9D9] border-b border-[#F0E9D9]">
        {[['74%', 'Packet ready'], ['12', 'Jobs this week'], ['$41k', 'In production']].map(([v, l]) => (
          <div key={l} className="px-4 py-3">
            <p className="text-lg font-semibold tracking-tight text-[#211F1D]">{v}</p>
            <p className="mt-0.5 text-[11px] font-medium text-[#8A8272]">{l}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 p-4">
        {pipelineRows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 rounded-xl border border-[#EFE8D7] bg-white px-3.5 py-3">
            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: row.dot }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#211F1D]">{row.label}</p>
              <p className="text-xs text-[#8A8272]">{row.owner}</p>
            </div>
            <span className="ml-auto hidden rounded-full bg-[#F5F0E4] px-2.5 py-1 text-[11px] font-semibold text-[#6B655A] sm:inline">
              {row.status}
            </span>
            <span className="text-sm font-semibold tabular-nums text-[#211F1D]">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="mx-4 mb-4 rounded-xl bg-[#211F1D] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#C9A961]">Next move</p>
        <p className="mt-1.5 text-sm font-medium leading-6 text-[#F6F1E7]">
          Confirm roof measurements before the 4:30 visit.
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[74%] rounded-full bg-[#B0904E]" />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------- Canvass ------------------------------- */

const pins = [
  { x: 22, y: 30, c: '#B0904E' },   // hot lead
  { x: 46, y: 22, c: '#2B2A28' },   // not home
  { x: 68, y: 34, c: '#7C8A5A' },   // go back
  { x: 32, y: 54, c: '#2B2A28' },
  { x: 58, y: 60, c: '#B0904E' },
  { x: 80, y: 52, c: '#7C8A5A' },
  { x: 40, y: 74, c: '#B0904E' },
]

export function CanvassShot() {
  return (
    <div className="mx-auto w-[248px] rounded-[2.2rem] border-[7px] border-[#211F1D] bg-[#211F1D] shadow-2xl shadow-[#211F1D]/25">
      <div className="overflow-hidden rounded-[1.6rem] bg-white">
        {/* status bar */}
        <div className="flex items-center justify-between bg-[#211F1D] px-5 py-2 text-[10px] font-medium text-[#F6F1E7]">
          <span>9:41</span>
          <span className="tracking-widest">ARX CANVASS</span>
          <span>▚▚</span>
        </div>

        {/* map */}
        <div className="relative h-[300px] overflow-hidden bg-[#E7E2D0]">
          {/* streets */}
          <div className="absolute left-0 top-[38%] h-2 w-full -rotate-3 bg-[#F4F0E4]" />
          <div className="absolute left-0 top-[68%] h-2 w-full rotate-2 bg-[#F4F0E4]" />
          <div className="absolute left-[30%] top-0 h-full w-2 rotate-3 bg-[#F4F0E4]" />
          <div className="absolute left-[66%] top-0 h-full w-2 -rotate-2 bg-[#F4F0E4]" />
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_20%,rgba(176,144,78,0.10),transparent)]" />

          {/* pins */}
          {pins.map((p, i) => (
            <span
              key={i}
              className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundColor: p.c }}
            />
          ))}

          {/* cluster */}
          <span className="absolute left-[54%] top-[40%] flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#8A6D3B] text-xs font-bold text-white ring-4 ring-[#B0904E]/30">
            12
          </span>

          {/* rep location */}
          <span className="absolute left-[44%] top-[58%] -translate-x-1/2 -translate-y-1/2">
            <span className="absolute inline-flex h-6 w-6 animate-ping rounded-full bg-[#3B82F6]/40" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-[#3B82F6]" />
          </span>

          {/* top pill */}
          <div className="absolute left-3 right-3 top-3 flex items-center justify-between rounded-xl bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
            <span className="text-[11px] font-semibold text-[#211F1D]">Territory 4 · Kannapolis</span>
            <span className="rounded-full bg-[#B0904E]/15 px-2 py-0.5 text-[10px] font-bold text-[#8A6D3B]">LIVE</span>
          </div>
        </div>

        {/* bottom sheet */}
        <div className="border-t border-[#EFE8D7] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold text-[#211F1D]">Drop disposition</p>
            <p className="text-[10px] font-semibold text-[#8A8272]">444 · 312 doors</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ['Hot lead', true],
              ['Not home', false],
              ['Go back', false],
              ['Renter', false],
            ].map(([label, active]) => (
              <span
                key={label as string}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                  active
                    ? 'bg-[#211F1D] text-[#F6F1E7]'
                    : 'bg-[#F5F0E4] text-[#6B655A]'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------- Roof measure ----------------------------- */

export function MeasureShot() {
  return (
    <BrowserFrame title="app.arx — Roof measure">
      <div className="relative">
        {/* aerial-ish canvas */}
        <div className="relative h-[300px] bg-[#26241F]">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 26px), repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 26px)',
            }}
          />
          <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full">
            {/* facets */}
            <polygon points="70,60 200,60 135,140" fill="#B0904E" fillOpacity="0.18" />
            <polygon points="200,60 330,60 265,140" fill="#B0904E" fillOpacity="0.14" />
            <polygon points="70,60 135,140 135,240 70,240" fill="#B0904E" fillOpacity="0.1" />
            <polygon points="330,60 265,140 265,240 330,240" fill="#B0904E" fillOpacity="0.1" />
            <polygon points="135,140 265,140 265,240 135,240" fill="#B0904E" fillOpacity="0.22" />
            {/* outline + hips + ridge */}
            <g stroke="#E7C878" strokeWidth="2.5" fill="none" strokeLinejoin="round">
              <polygon points="70,60 330,60 330,240 70,240" />
              <line x1="70" y1="60" x2="135" y2="140" />
              <line x1="330" y1="60" x2="265" y2="140" />
              <line x1="70" y1="240" x2="135" y2="140" />
              <line x1="330" y1="240" x2="265" y2="140" />
              <line x1="135" y1="140" x2="265" y2="140" />
              <line x1="200" y1="60" x2="135" y2="140" strokeDasharray="4 4" strokeWidth="1.5" />
              <line x1="200" y1="60" x2="265" y2="140" strokeDasharray="4 4" strokeWidth="1.5" />
            </g>
            {/* vertices */}
            {[
              [70, 60], [330, 60], [330, 240], [70, 240], [135, 140], [265, 140],
            ].map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x - 3.5} y={y - 3.5} width="7" height="7" fill="#F6F1E7" stroke="#B0904E" strokeWidth="1.5" />
            ))}
            {/* edge labels */}
            <g fill="#F6F1E7" fontSize="12" fontWeight="700" textAnchor="middle">
              <text x="200" y="52">34&apos; 2&quot;</text>
              <text x="348" y="154">21&apos; 8&quot;</text>
              <text x="200" y="132">Ridge · 12&apos;</text>
            </g>
          </svg>

          {/* measurement summary card */}
          <div className="absolute right-3 top-3 w-40 rounded-xl border border-white/10 bg-[#F6F1E7] p-3 shadow-xl">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#8A6D3B]">Roof total</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight text-[#211F1D]">28.4 <span className="text-sm font-bold text-[#8A8272]">sq</span></p>
            <div className="mt-2 space-y-1 border-t border-[#E7DECB] pt-2 text-[11px]">
              {[
                ['Ridge', '41 LF'],
                ['Hips', '63 LF'],
                ['Valleys', '22 LF'],
                ['Waste', '12%'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-[#6B655A]">{k}</span>
                  <span className="font-semibold text-[#211F1D]">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}
