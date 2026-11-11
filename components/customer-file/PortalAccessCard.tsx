'use client'

import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'

/** The Customer File's "Sign out of portal": ends every open portal session for this customer and cancels their unused sign-in links. */
export default function PortalAccessCard({ customerId }: { customerId: string }) {
  const [busy, setBusy] = React.useState(false)
  async function signOut() {
    setBusy(true)
    const res = await fetch(`/api/customers/${customerId}/portal-signout`, { method: 'POST' }).catch(() => null)
    setBusy(false)
    if (res?.ok) toast.success('Signed out of the customer account everywhere')
    else toast.error('Could not sign them out. Please try again.')
  }
  return (
    <Card>
      <CardHeader><CardTitle>Customer account (portal)</CardTitle></CardHeader>
      <CardContent>
        <p className="text-ui-base text-ink">The customer signs in with a link we email them. If their phone or email was lost or changed hands, sign them out here: every open session ends and unused links stop working.</p>
        <Button type="button" variant="secondary" className="mt-3 min-h-tap" onClick={() => void signOut()} disabled={busy}>{busy ? 'Signing out…' : 'Sign out of portal'}</Button>
      </CardContent>
    </Card>
  )
}
