import Link from 'next/link'

import { cn } from '@/lib/cn'

/**
 * The one "back" link for every Settings sub-page (Settings hub = /admin). Sits above the page title.
 * `href`/`label` point a nested page at its real parent page instead (e.g. Email blasts → resend-today).
 * `tone="dark"` is only for the dark Sisu hub.
 */
export default function SettingsBackLink({ href = '/admin', label = 'Settings', tone = 'light', className }: { href?: string; label?: string; tone?: 'light' | 'dark'; className?: string }) {
  return (
    <Link
      href={href}
      data-testid="settings-back-link"
      className={cn(
        'mb-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold hover:underline',
        tone === 'dark' ? 'text-indigo-200' : 'text-[#2c2c2a]',
        className,
      )}
    >
      <span aria-hidden="true">←</span> {label}
    </Link>
  )
}
