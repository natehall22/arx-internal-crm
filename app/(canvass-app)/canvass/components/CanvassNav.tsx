'use client'

interface Props {
  viewMode: 'map' | 'list'
  onViewModeChange: (mode: 'map' | 'list') => void
  todayCount: number
}

export default function CanvassNav({ viewMode, onViewModeChange, todayCount }: Props) {
  return (
    <nav className="bg-white border-t px-4 py-2 safe-area-bottom">
      <div className="flex items-center justify-around">
        <button
          onClick={() => onViewModeChange('map')}
          className={`flex flex-col items-center py-2 px-6 rounded-xl transition-colors ${
            viewMode === 'map' ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span className="text-xs mt-1 font-medium">Map</span>
        </button>

        <button
          onClick={() => onViewModeChange('list')}
          className={`flex flex-col items-center py-2 px-6 rounded-xl transition-colors relative ${
            viewMode === 'list' ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <span className="text-xs mt-1 font-medium">List</span>
          {todayCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-indigo-600 text-white text-xs rounded-full flex items-center justify-center px-1">
              {todayCount}
            </span>
          )}
        </button>

        <a
          href="/dashboard"
          className="flex flex-col items-center py-2 px-6 rounded-xl text-gray-500"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-xs mt-1 font-medium">Stats</span>
        </a>

        <a
          href="/canvass/settings"
          className="flex flex-col items-center py-2 px-6 rounded-xl text-gray-500"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs mt-1 font-medium">Settings</span>
        </a>
      </div>
    </nav>
  )
}
