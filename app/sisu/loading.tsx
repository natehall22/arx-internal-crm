import Nav from '@/components/Nav'

export default function IncentivesLoading() {
  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 pb-16 pt-6 space-y-8">
        {/* Page header skeleton */}
        <div className="animate-pulse">
          <div className="h-4 w-28 bg-gray-800 rounded mb-2" />
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gray-800" />
            <div className="space-y-2">
              <div className="h-7 w-28 bg-gray-800 rounded" />
              <div className="h-4 w-40 bg-gray-800 rounded" />
            </div>
          </div>
        </div>

        {/* Tab toggle skeleton */}
        <div className="grid grid-cols-2 rounded-full border border-gray-800 bg-gray-900 p-1 animate-pulse">
          <div className="h-9 rounded-full bg-gray-800" />
          <div className="h-9 rounded-full bg-gray-800/40" />
        </div>

        {/* Badges + next unlock skeleton */}
        <div>
          <div className="h-5 w-24 bg-gray-800 rounded mb-4 animate-pulse" />
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 mb-5 animate-pulse">
            <div className="h-3 w-20 bg-gray-800 rounded mb-3" />
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-full bg-gray-800 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-gray-800 rounded" />
                <div className="h-2 w-full bg-gray-800 rounded-full" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Hero skeleton — earnings dominant, then rank widget, then metric */}
        <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 animate-pulse">
          <div className="flex flex-col items-center mb-5">
            <div className="h-14 w-36 bg-gray-700 rounded mb-2" />
            <div className="h-3 w-28 bg-gray-800 rounded" />
          </div>
          <div className="h-12 w-full bg-gray-800 rounded-xl mb-6" />
          <div className="h-3 w-16 bg-gray-800 rounded mb-4" />
          <div className="h-16 w-20 bg-gray-700 rounded mb-4" />
          <div className="h-2.5 w-full bg-gray-800 rounded-full mb-5" />
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1 h-14 bg-gray-800 rounded-xl" />
            ))}
          </div>
        </div>

        {/* 444 program skeleton */}
        <div className="rounded-2xl border border-gray-800 p-5 animate-pulse bg-gray-900/50 space-y-4">
          <div className="h-5 w-36 bg-gray-800 rounded" />
          <div className="h-10 w-full max-w-xs mx-auto bg-gray-800 rounded" />
          <div className="space-y-2">
            <div className="h-2 w-full bg-gray-800 rounded-full" />
            <div className="h-2 w-full bg-gray-800 rounded-full" />
          </div>
        </div>

        {/* Heat cards skeleton */}
        <div>
          <div className="h-5 w-28 bg-gray-800 rounded mb-4 animate-pulse" />
          <div className="flex gap-3 overflow-hidden">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex-shrink-0 w-[min(18rem,85vw)] sm:w-72 h-52 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
