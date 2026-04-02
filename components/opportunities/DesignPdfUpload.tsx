'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DesignPdfUpload({ opportunityId }: { opportunityId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const fd = new FormData(form)
    const file = fd.get('design_pdf')
    if (!(file instanceof Blob) || file.size === 0) {
      setError('Choose a PDF file.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/design-pdf`, {
        method: 'POST',
        body: fd,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Upload failed')
        return
      }
      form.reset()
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="design_pdf"
          accept="application/pdf,.pdf"
          required
          disabled={pending}
          className="text-sm text-gray-700 file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-indigo-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? 'Uploading…' : 'Upload Design PDF'}
        </button>
      </div>
    </form>
  )
}
