import { redirect } from 'next/navigation'

export default function InsideSalesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const next = new URLSearchParams()
  next.set('view', 'inside_sales')

  for (const [key, value] of Object.entries(searchParams || {})) {
    if (key === 'view') continue
    if (typeof value === 'string' && value) {
      next.set(key, value)
    } else if (Array.isArray(value) && value[0]) {
      next.set(key, value[0])
    }
  }

  redirect(`/opportunities?${next.toString()}`)
}
