'use client'

import type { useJobPhotoQueue } from '@/components/job/useJobPhotoQueue'

type Queue = ReturnType<typeof useJobPhotoQueue>

/** Photos waiting on this phone, and the ones that were refused (with Try again / Remove). */
export default function PhotoQueueNotice({ queue, className = '' }: { queue: Queue; className?: string }) {
  const waiting = queue.pending - queue.failed.count
  if (queue.pending === 0) return null
  return (
    <div className={`space-y-2 ${className}`} role="status">
      {waiting > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-[#2c2c2a]">
          {waiting} photo{waiting === 1 ? '' : 's'} saved on this phone, {queue.flushing ? 'uploading now…' : 'waiting for signal. They upload by themselves.'}
        </p>
      )}
      {queue.failed.count > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-[#2c2c2a]">
          <p>
            {queue.failed.count} photo{queue.failed.count === 1 ? ' was' : 's were'} not accepted{queue.failed.lastError ? `: ${queue.failed.lastError}` : '.'}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void queue.retryFailed()} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold">Try again</button>
            <button type="button" onClick={() => void queue.removeFailed()} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold">Remove</button>
          </div>
        </div>
      )}
    </div>
  )
}
