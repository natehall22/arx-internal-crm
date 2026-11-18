'use client'

import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, toast } from '@/components/ui'

/**
 * The Customer File's portal card. "Invite to portal" (one tap) emails the customer their sign-in link and, in an invite-only
 * company, is what lets them in at all. "Sign out of portal" ends every open session and unused link; "Remove access" also
 * takes the invitation away.
 */
export default function PortalAccessCard({ customerId, hasEmail = true, inviteOnly = false, invitedAt = null, canCopyLink = false, emailSuppressed = false }: { customerId: string; hasEmail?: boolean; inviteOnly?: boolean; invitedAt?: string | null; canCopyLink?: boolean; emailSuppressed?: boolean }) {
  const [busy, setBusy] = React.useState<'' | 'invite' | 'signout' | 'remove' | 'link'>('')
  const [invited, setInvited] = React.useState(!!invitedAt)
  // Set when the server says this customer needs an invitation although the card thought otherwise (stale props).
  const [serverInviteOnly, setServerInviteOnly] = React.useState(false)
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
  /** Owners/admins: a one-time 20-minute link, copied (demo companies send no email, so this is how the portal gets tested). */
  async function copyLink() {
    // Invite-only company + not invited yet: the link only works if they are invited, so say so and make that the explicit choice.
    const invite = (inviteOnly || serverInviteOnly) && !invited
    // A demo company's email is suppressed, so the link goes nowhere else: no confirm. A real company asks first.
    if (!emailSuppressed) {
      const ok = await confirmDialog({
        title: invite ? 'Invite and copy a sign-in link?' : 'Copy a sign-in link?',
        description: `Nothing is emailed. Anyone with this link can open this customer's portal once, and it stops working after 20 minutes.${invite ? ' This also invites them to the portal, so they can sign in themselves later (use "Remove access" to undo).' : ' It does not invite them or change their access.'}`,
        confirmLabel: invite ? 'Invite and copy link' : 'Copy link',
      })
      if (!ok) return
    }
    setBusy('link')
    const res = await fetch(`/api/customers/${customerId}/portal-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite }) }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as { url?: string; error?: string; invited?: boolean; needsInvite?: boolean } | null
    setBusy('')
    if (body?.needsInvite) {
      // Show the card as uninvited so "Invite and copy link" is offered on the next tap.
      setInvited(false)
      setServerInviteOnly(true)
    }
    if (!res?.ok || !body?.url) return toast.error(body?.error || 'That did not work. Please try again.')
    if (body.invited) setInvited(true)
    try {
      await navigator.clipboard.writeText(body.url)
      toast.success('Link copied. It works once, for 20 minutes. Open it in a private window to test.')
    } catch {
      window.prompt('Copy this sign-in link (works once, 20 minutes):', body.url)
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Customer account (portal)</CardTitle></CardHeader>
      <CardContent>
        <p className="text-ui-base text-ink">
          {inviteOnly
            ? invited ? 'Invited. They sign in with a link we email them; they can ask for a new one any time at your portal address.' : 'Not invited yet. Only customers you invite can sign in.'
            : 'The customer signs in with a link we email them.'}
          {emailSuppressed ? ' This is a demo company: email is never sent, so use "Copy sign-in link".' : ''}
          {!hasEmail ? ' Add an email address to this customer first.' : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" className="min-h-tap" onClick={() => void call('invite')} disabled={!!busy || !hasEmail}>{busy === 'invite' ? 'Sending…' : invited ? 'Send the link again' : 'Invite to portal'}</Button>
          <Button type="button" variant="secondary" className="min-h-tap" onClick={() => void call('signout')} disabled={!!busy}>{busy === 'signout' ? 'Signing out…' : 'Sign out of portal'}</Button>
          {canCopyLink ? <Button type="button" variant="secondary" className="min-h-tap" onClick={() => void copyLink()} disabled={!!busy}>{busy === 'link' ? 'Making link…' : 'Copy sign-in link'}</Button> : null}
          {invited ? <Button type="button" variant="secondary" className="min-h-tap" onClick={() => void call('remove')} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove access'}</Button> : null}
        </div>
        <p className="mt-2 text-ui-sm text-ink">If their phone or email was lost or changed hands, sign them out: every open session ends and unused links stop working.</p>
      </CardContent>
    </Card>
  )
}
