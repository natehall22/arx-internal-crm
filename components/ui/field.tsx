import * as React from 'react'

import { cn } from '@/lib/cn'

const control =
  'min-h-tap w-full rounded-ui border border-surface-line bg-surface px-3 py-2 text-ui-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 aria-[invalid=true]:border-danger'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, className)} {...p} />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-[6rem]', className)} {...p} />
))
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(control, className)} {...p} />
))
Select.displayName = 'Select'

/** Label + control + optional hint/error, wired together (htmlFor / aria-describedby) so a screen reader announces them. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode; className?: string }) {
  const id = React.useId()
  const describedBy = error || hint ? `${id}-desc` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-ui-sm font-semibold text-ink">{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error || hint ? (
        <p id={describedBy} className={cn('text-ui-sm', error ? 'text-danger' : 'text-ink-muted')}>{error ?? hint}</p>
      ) : null}
    </div>
  )
}
