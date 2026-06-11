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

export default function CanvassNav({
  viewMode,
  onViewModeChange,
  todayCount,
  showWorkAreasLink = false,
  workAreasActive = false,
  onWorkAreas,
}: Props) {
  return (
    <nav className="bg-white border-t px-2 sm:px-4 py-2 safe-area-bottom">
      <div className="flex items-center justify-around gap-0.5 sm:gap-1 max-w-lg mx-auto">
        <button
          type="button"
          onClick={() => onViewModeChange('map')}
          className={`flex flex-col items-center py-2 px-6 rounded-xl transition-colors ${
            viewMode === 'map' && !workAreasActive ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span className="text-[10px] sm:text-xs mt-1 font-medium leading-tight text-center">Map</span>
        </button>

        {showWorkAreasLink &&
          (onWorkAreas ? (
            <button
              type="button"
              onClick={onWorkAreas}
              className={`flex flex-col items-center py-2 px-2 sm:px-4 rounded-xl transition-colors ${
                workAreasActive ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500 hover:text-indigo-600'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9h6v6H9V9z" />
              </svg>
              <span className="text-[10px] sm:text-xs mt-1 font-medium leading-tight text-center">Areas</span>
            </button>
          ) : (
            <a
              href="/canvass?areas=1"
              className="flex flex-col items-center py-2 px-2 sm:px-4 rounded-xl text-gray-500 hover:text-indigo-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9h6v6H9V9z" />
              </svg>
              <span className="text-[10px] sm:text-xs mt-1 font-medium leading-tight text-center">Areas</span>
            </a>
          ))}

        <button
          type="button"
          onClick={() => onViewModeChange('list')}
          className={`flex flex-col items-center py-2 px-6 rounded-xl transition-colors relative ${
            viewMode === 'list' && !workAreasActive ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <span className="text-[10px] sm:text-xs mt-1 font-medium leading-tight text-center">List</span>
          {todayCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-indigo-600 text-white text-xs rounded-full flex items-center justify-center px-1">
              {todayCount}
            </span>
          )}
        </button>

        <a
          href="/sisu"
          className="flex flex-col items-center py-2 px-6 rounded-xl text-gray-500"
        >
          {/* Sisu flame mark (see public/brand/sisu-mark.svg) */}
          <svg className="w-6 h-6" viewBox="0 0 64 64" fill="none">
            <defs>
              <linearGradient id="sisuNavFlame" x1="32" y1="3" x2="32" y2="61" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#818cf8" />
                <stop offset="0.55" stopColor="#6366f1" />
                <stop offset="1" stopColor="#7c3aed" />
              </linearGradient>
              <linearGradient id="sisuNavCore" x1="32" y1="22" x2="32" y2="54" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#fde68a" />
                <stop offset="0.5" stopColor="#fbbf24" />
                <stop offset="1" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <path
              d="M32 3 C33.5 13 44 17 47 26 C50 34.5 48 44.5 42 51.5 C39 55 35.5 58.5 32 61 C28.5 58.5 25 55 22 51.5 C16 44.5 14 34.5 17 26 C20 17 30.5 13 32 3 Z"
              fill="url(#sisuNavFlame)"
            />
            <path
              d="M32 23 C33 29.5 39.5 32.5 40.5 39 C41.5 45 38 50.5 32 54 C26 50.5 22.5 45 23.5 39 C24.5 32.5 31 29.5 32 23 Z"
              fill="url(#sisuNavCore)"
            />
            <circle cx="45.5" cy="11.5" r="2.5" fill="#fbbf24" />
          </svg>
          <span className="text-[10px] sm:text-xs mt-1 font-medium leading-tight text-center">Sisu</span>
        </a>

        <a
          href="/canvass/settings"
          className="flex flex-col items-center py-2 px-6 rounded-xl text-gray-500"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px] sm:text-xs mt-1 font-medium leading-tight text-center">Settings</span>
        </a>
      </div>
    </nav>
  )
}
