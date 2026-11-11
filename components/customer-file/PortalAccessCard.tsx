'use client'

import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'

/**
 * The Customer File's portal card. "Invite to portal" (one tap) emails the customer their sign-in link and, in an invite-only
 * company, is what lets them in at all. "Sign out of portal" ends every open session and unused link; "Remove access" also
 * takes the invitation away.
 */
export default function PortalAccessCard({ customerId, hasEmail = true, inviteOnly = false, invitedAt = null }: { customerId: string; hasEmail?: boolean; inviteOnly?: boolean; invitedAt?: string | null }) {
  const [busy, setBusy] = React.useState<'' | 'invite' | 'signout' | 'remove'>('')
  const [invited, setInvited] = React.useState(!!invitedAt)
  async function call(kind: 'invite' | 'signout' | 'remove') {
    setBusy(kind)
    const url = kind === 'signout' ? `/api/customers/${customerId}/portal-signout` : `/api/customers/${customerId}/portal-invite`
    const res = await fetch(url, { method: kind === 'invite' || kind === 'signout' ? 'POST' : 'DELETE' }).catch(() => null)
    setBusy('')
    if (res?.ok) {
      if (kind === 'invite') { setInvited(true); toast.success('Invitation emailed') }
      else if (kind === 'remove') { setInvited(false); toast.success('Portal access removed') }
      else toast.success('Signed out of the customer account everywhere')
      return
    }
    const msg = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error
    toast.error(msg || 'That did not work. Please try again.')
  }
  return (
    <Card>
      <CardHeader><CardTitle>Customer account (portal)</CardTitle></CardHeader>
      <CardContent>
        <p className="text-ui-base text-ink">
          {inviteOnly
            ? invited ? 'Invited. They sign in with a link we email them; they can ask for a new one any time at your portal address.' : 'Not invited yet. Only customers you invite can sign in.'
            : 'The customer signs in with a link we email them.'}
          {!hasEmail ? ' Add an email address to this customer first.' : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" className="min-h-tap" onClick={() => void call('invite')} disabled={!!busy || !hasEmail}>{busy === 'invite' ? 'Sending…' : invited ? 'Send the link again' : 'Invite to portal'}</Button>
          <Button type="button" variant="secondary" className="min-h-tap" onClick={() => void call('signout')} disabled={!!busy}>{busy === 'signout' ? 'Signing out…' : 'Sign out of portal'}</Button>
          {invited ? <Button type="button" variant="secondary" className="min-h-tap" onClick={() => void call('remove')} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove access'}</Button> : null}
        </div>
        <p className="mt-2 text-ui-sm text-ink">If their phone or email was lost or changed hands, sign them out: every open session ends and unused links stop working.</p>
      </CardContent>
    </Card>
  )
}
