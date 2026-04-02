'use client'

import { useState, useTransition, useEffect } from 'react'

interface ProjectAddressEditProps {
  currentAddress: string | null
  updateAddressAction: (formData: FormData) => Promise<void>
}

export default function ProjectAddressEdit({
  currentAddress,
  updateAddressAction,
}: ProjectAddressEditProps) {
  const [value, setValue] = useState(currentAddress ?? '')
  const [isPending, startTransition] = useTransition()
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    setValue(currentAddress ?? '')
  }, [currentAddress])

  return (
    <div className="relative mt-1">
      <p className="text-xs text-gray-500 mb-2">
        Job site address on this project. It may have been copied from the proposal when the project was
        created — it does not auto-update when you link a customer.
      </p>
      <form
        className="flex flex-col sm:flex-row sm:items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          startTransition(() => {
            void (async () => {
              await updateAddressAction(fd)
              setShowSuccess(true)
              setTimeout(() => setShowSuccess(false), 3000)
            })()
          })
        }}
      >
        <textarea
          name="address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={2}
          disabled={isPending}
          className="flex-1 text-sm rounded-md border border-gray-300 px-3 py-2 w-full min-w-0"
          placeholder="Street, city, state, ZIP"
        />
        <button
          type="submit"
          disabled={isPending || !value.trim()}
          className="shrink-0 text-sm bg-indigo-600 text-white px-3 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {showSuccess && (
        <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-green-100 text-green-800 text-xs rounded-md shadow-sm border border-green-200 z-10">
          Address updated
        </div>
      )}
    </div>
  )
}
