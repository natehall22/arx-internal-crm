'use client'

interface Props {
  pendingCount: number
  isOnline: boolean
  isSyncing?: boolean
}

export default function SyncStatus({ pendingCount, isOnline, isSyncing = false }: Props) {
  if (isOnline && pendingCount === 0) {
    return (
      <div className="flex items-center gap-1.5 text-indigo-200">
        <span className="w-2 h-2 bg-green-400 rounded-full"></span>
        <span className="text-xs">Synced</span>
      </div>
    )
  }

  if (!isOnline) {
    return (
      <div className="flex items-center gap-1.5 text-yellow-300">
        <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
        <span className="text-xs">Offline</span>
        {pendingCount > 0 && (
          <span className="text-xs">({pendingCount} pending)</span>
        )}
      </div>
    )
  }

  if (!isSyncing) {
    return (
      <div className="flex items-center gap-1.5 text-yellow-300">
        <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
        <span className="text-xs">Pending sync</span>
        {pendingCount > 0 && (
          <span className="text-xs">({pendingCount})</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-indigo-200">
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span className="text-xs">Syncing {pendingCount}...</span>
    </div>
  )
}
