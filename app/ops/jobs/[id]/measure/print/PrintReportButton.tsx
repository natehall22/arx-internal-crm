'use client'

export default function PrintReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="min-h-[44px] rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
    >
      Print / Save PDF
    </button>
  )
}
