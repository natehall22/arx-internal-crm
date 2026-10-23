'use client'

import * as React from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'

import { Button } from '@/components/ui/button'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive actions. */
  destructive?: boolean
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }
let open: ((p: Pending) => void) | null = null

/**
 * Promise-based replacement for window.confirm():  `if (!(await confirmDialog({ title: 'Delete this?' }))) return`
 * Needs <ConfirmHost /> mounted once (root layout). Resolves false if the host isn't mounted, so a missing host
 * can never silently approve a destructive action.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!open) return resolve(false)
    // A second call while one is showing replaces it: settle the first as "no" so its caller never hangs.
    open({ ...options, resolve })
  })
}

export function ConfirmHost() {
  const [pending, setPending] = React.useState<Pending | null>(null)
  React.useEffect(() => {
    open = (p) => setPending((prev) => {
      prev?.resolve(false)
      return p
    })
    return () => {
      open = null
    }
  }, [])
  const [head, ...tail] = (pending?.title ?? '').split('\n')
  const body = [...(tail.length ? [tail.join('\n').trim()] : []), pending?.description ?? ''].filter(Boolean).join('\n')
  const finish = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }
  return (
    <AlertDialog.Root open={!!pending} onOpenChange={(o) => !o && finish(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <AlertDialog.Content className="fixed inset-x-0 bottom-0 z-[60] flex flex-col gap-3 rounded-t-2xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-ui sm:pb-5">
          <AlertDialog.Title className="text-ui-lg font-semibold">{head}</AlertDialog.Title>
          <AlertDialog.Description className="whitespace-pre-line text-ui-base text-ink-muted">{body}</AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => finish(false)}>{pending?.cancelLabel ?? 'Cancel'}</Button>
            <Button variant={pending?.destructive ? 'danger' : 'primary'} onClick={() => finish(true)}>{pending?.confirmLabel ?? 'Confirm'}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
