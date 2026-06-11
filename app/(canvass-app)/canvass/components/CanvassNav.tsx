'use client'

interface Props {
  viewMode: 'map' | 'list'
  onViewModeChange: (mode: 'map' | 'list') => void
  todayCount: number
  /** Managers: draw work areas / assign reps (hidden for field reps). */
  showWorkAreasLink?: boolean
  /** True while `/canvass?areas=1` work-areas panel is open. */
  workAreasActive?: boolean
  /** Opens work areas (sets `?areas=1`); use with main canvass shell. */
  onWorkAreas?: () => void
}

const tabBase =
  'flex flex-1 basis-0 flex-col items-center gap-1 rounded-2xl py-2 transition-all duration-150 active:scale-[0.96] select-none'
const tabIdle = 'text-gray-500 hover:text-indigo-600'
const tabActive = 'text-indigo-600 bg-indigo-50'

/** Sisu brand mark: cut S on black tile (see public/brand/sisu-mark.svg). */
function SisuMark() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="sisuNavCut">
          <path d="M0 -2 L64 -2 L64 30.84 L0 36.44 Z M0 39.29 L64 33.69 L64 66 L0 66 Z" />
        </clipPath>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0A0A0B" />
      <g fill="#D8FF3D" clipPath="url(#sisuNavCut)">
        <path d="M29.93 51.17Q24.77 51.17 22.85 48.60Q20.93 46.04 21.72 40.43L22.24 36.75H29.69L29.02 41.46Q28.84 42.76 29.13 43.50Q29.42 44.24 30.41 44.24Q31.44 44.24 31.92 43.64Q32.40 43.04 32.59 41.67Q32.83 39.94 32.65 38.77Q32.47 37.61 31.78 36.55Q31.08 35.49 29.78 34.08L26.85 30.87Q23.57 27.29 24.22 22.69Q24.89 17.88 27.48 15.35Q30.07 12.83 34.31 12.83Q39.49 12.83 41.27 15.59Q43.06 18.35 42.26 23.98H34.60L34.97 21.39Q35.08 20.62 34.70 20.19Q34.32 19.76 33.57 19.76Q32.67 19.76 32.18 20.26Q31.70 20.77 31.58 21.56Q31.47 22.35 31.77 23.27Q32.07 24.19 33.16 25.39L36.92 29.56Q38.05 30.80 38.95 32.18Q39.85 33.56 40.25 35.39Q40.66 37.22 40.29 39.85Q39.54 45.16 37.16 48.16Q34.78 51.17 29.93 51.17Z" />
      </g>
    </svg>
  )
}

export default function CanvassNav({
  viewMode,
  onViewModeChange,
  todayCount,
  showWorkAreasLink = false,
  workAreasActive = false,
  onWorkAreas,
}: Props) {
  const mapActive = viewMode !== 'list' && !workAreasActive

  const areasIcon = (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 9h6v6H9V9z" />
    </svg>
  )

  return (
    <nav className="bg-white/95 backdrop-blur border-t border-gray-200 px-3 pt-1.5 pb-1.5 safe-area-bottom shadow-[0_-6px_20px_rgba(15,15,20,0.06)]">
      <div className="flex items-stretch gap-1 max-w-lg mx-auto">
        <button
          type="button"
          onClick={() => onViewModeChange('map')}
          aria-current={mapActive ? 'page' : undefined}
          className={`${tabBase} ${mapActive ? tabActive : tabIdle}`}
        >
          <span className="relative">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            {todayCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] bg-indigo-600 text-white text-[10px] font-semibold rounded-full flex items-center justify-center px-1 shadow-sm">
                {todayCount > 99 ? '99+' : todayCount}
              </span>
            )}
          </span>
          <span className={`text-[11px] leading-tight ${mapActive ? 'font-semibold' : 'font-medium'}`}>Map</span>
        </button>

        {showWorkAreasLink &&
          (onWorkAreas ? (
            <button
              type="button"
              onClick={onWorkAreas}
              aria-current={workAreasActive ? 'page' : undefined}
              className={`${tabBase} ${workAreasActive ? tabActive : tabIdle}`}
            >
              {areasIcon}
              <span className={`text-[11px] leading-tight ${workAreasActive ? 'font-semibold' : 'font-medium'}`}>
                Areas
              </span>
            </button>
          ) : (
            <a href="/canvass?areas=1" className={`${tabBase} ${tabIdle}`}>
              {areasIcon}
              <span className="text-[11px] font-medium leading-tight">Areas</span>
            </a>
          ))}

        <a href="/sisu" className={`${tabBase} ${tabIdle}`}>
          <SisuMark />
          <span className="text-[11px] font-medium leading-tight">Sisu</span>
        </a>

        <a href="/canvass/settings" className={`${tabBase} ${tabIdle}`}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[11px] font-medium leading-tight">Settings</span>
        </a>
      </div>
    </nav>
  )
}
