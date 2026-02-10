'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ padding: 24 }}>
      <h2>Something went wrong</h2>
      <p style={{ marginTop: 8, color: '#666' }}>
        {error?.message || 'Unexpected error'}
      </p>
      <button style={{ marginTop: 12 }} onClick={() => reset()}>
        Try again
      </button>
    </div>
  )
}
