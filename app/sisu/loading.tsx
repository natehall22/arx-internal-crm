import Nav from '@/components/Nav'

export default function IncentivesLoading() {
  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 pb-16 pt-6 space-y-6">
        {/* Tab toggle skeleton */}
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-full bg-gray-800 animate-pulse" />
          <div className="h-9 w-28 rounded-full bg-gray-800 animate-pulse" />
        </div>

        {/* Hero skeleton */}
        <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 animate-pulse">
          <div className="h-4 w-32 bg-gray-700 rounded mb-3" />
          <div className="h-14 w-24 bg-gray-700 rounded mb-4" />
          <div className="h-3 w-48 bg-gray-800 rounded mb-3" />
          <div className="h-2.5 w-full bg-gray-800 rounded-full mb-5" />
          <div className="flex gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1 h-14 bg-gray-800 rounded-xl" />
            ))}
          </div>
        </div>

        {/* 444 program skeleton */}
        <div className="rounded-2xl border border-gray-800 h-40 animate-pulse bg-gray-900/50" />

        {/* Heat cards skeleton */}
        <div>
          <div className="h-5 w-28 bg-gray-800 rounded mb-4 animate-pulse" />
          <div className="flex gap-3 overflow-hidden">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex-shrink-0 w-72 h-52 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Badges skeleton */}
        <div>
          <div className="h-5 w-24 bg-gray-800 rounded mb-4 animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
