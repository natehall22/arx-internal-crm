import { notFound, redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { verifyConsentTicket } from '@/lib/ai-connector/crypto'

export const dynamic = 'force-dynamic'

/** After sign-in: back to the consent screen with the request the app made (the login page cannot carry a query string). */
export default async function ResumePage({ params }: { params: { ticket: string } }) {
  await requireAuth()
  const p = verifyConsentTicket(params.ticket, 'anonymous')
  if (!p) notFound()
  redirect(`/oauth/authorize?${new URLSearchParams(p).toString()}`)
}
