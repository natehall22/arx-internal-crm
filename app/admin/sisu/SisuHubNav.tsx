'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const TABS = [
  { label: 'Heats', href: '/admin/sisu/incentives' },
  { label: 'Badges', href: '/admin/sisu/incentives?tab=badges' },
  { label: 'Setter Ramp', href: '/admin/sisu/setter-ramp' },
  { label: 'Bonus Approval', href: '/admin/sisu/bonus-approval' },
  { label: 'Accountability', href: '/admin/sisu/accountability' },
] as const

function isTabActive(pathname: string, tab: string, searchTab: string | null): boolean {
  if (tab === '/admin/sisu/incentives') {
    return pathname === '/admin/sisu/incentives' && searchTab !== 'badges'
  }
  if (tab === '/admin/sisu/incentives?tab=badges') {
    return pathname === '/admin/sisu/incentives' && searchTab === 'badges'
  }
  if (tab === '/admin/sisu/bonus-approval') {
    return pathname === '/admin/sisu/bonus-approval'
  }
  return pathname === tab
}

export default function SisuHubNav({ showBonusApproval = false }: { showBonusApproval?: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchTab = searchParams.get('tab')
  const visibleTabs = TABS.filter(
    (tab) => tab.href !== '/admin/sisu/bonus-approval' || showBonusApproval,
  )

  return (
    <nav
      aria-label="Sisu admin sections"
      className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1"
    >
      {visibleTabs.map((tab) => {
        const active = isTabActive(pathname, tab.href, searchTab)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              active
                ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-950/40'
                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
