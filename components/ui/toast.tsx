'use client'

import { Toaster as Sonner, toast as sonnerToast } from 'sonner'

/**
 * Replaces window.alert(). `toast('Saved')`, `toast.error('Could not save')`.
 * Errors stay up until dismissed (the same message shows once); everything else clears itself.
 */
export const toast = Object.assign((message: unknown) => sonnerToast(String(message ?? '')), {
  success: (message: unknown) => sonnerToast.success(String(message ?? '')),
  error: (message: unknown) => sonnerToast.error(String(message ?? ''), { id: `err:${String(message ?? '')}`, duration: Infinity, closeButton: true }),
})

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset="calc(0.75rem + env(safe-area-inset-top))"
      toastOptions={{ classNames: { toast: '!text-ui-sm !text-ink !bg-surface !border-surface-line' } }}
    />
  )
}
