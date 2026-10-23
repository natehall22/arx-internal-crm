'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'
import {
  canAccessCustomerRecords,
  canAccessCustomerRecordsFromPermissionNames,
  canAccessJobBoardFromPermissionNames,
  canAccessOpsDashboardFromPermissionNames,
  canAccessReports,
  canAccessReportsFromPermissionNames,
  isBarredFromProjectsUi,
  isBarredFromSalesDocAccess,
  isOrgSuperuserRoleSlug,
} from '@/lib/permissions'
import { canViewInsideSalesFollowUp } from '@/lib/inside-sales-follow-up'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { activeSectionId, visibleNav } from '@/lib/nav-config'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import GlobalSearch from '@/components/search/GlobalSearch'
import { BarChart3, DollarSign, Filter, Hammer, Home, MapPin, MoreHorizontal, Search, Users, type LucideIcon } from 'lucide-react'
import NotificationBell from './NotificationBell'
import FeedbackButton from './FeedbackButton'
import AnnouncementBanner from './AnnouncementBanner'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabaseRef = useRef<ReturnType<typeof createClientBrowser> | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userPermissions, setUserPermissions] = useState<string[]>([])
  const [effectivePermsReady, setEffectivePermsReady] = useState(false)
  const [effectiveFullAccess, setEffectiveFullAccess] = useState(false)
  const [effectivePermissionNames, setEffectivePermissionNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState<string>('ARX CRM')
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [customRoleName, setCustomRoleName] = useState<string | null>(null)
  const [customRoleDisplayName, setCustomRoleDisplayName] = useState<string | null>(null)

  const normalizeRole = (role: unknown): string | null => {
    const normalized = String(role || '').toLowerCase().trim()
    return normalized || null
  }

  useEffect(() => {
    const loadUserRoleAndPermissions = async () => {
      const supabase = createClientBrowser()
      supabaseRef.current = supabase

      // Fetch effective permissions first — unconditionally. The Supabase browser
      // client cannot read HttpOnly session cookies, so getSession()/getUser() return
      // null even for authenticated users. The server API reads cookies directly and
      // is the single authoritative source for role + permissions.
      try {
        const res = await fetch('/api/me/effective-permissions', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const data = await res.json().catch(() => null)
        if (
          res.ok &&
          data &&
          typeof data === 'object' &&
          !('error' in data && (data as { error?: unknown }).error)
        ) {
          const serverRole = normalizeRole((data as { role?: unknown }).role)
          if (serverRole) {
            setUserRole(serverRole)
          }
          const apiFullAccess =
            Boolean((data as { fullAccess?: unknown }).fullAccess) ||
            isOrgSuperuserRoleSlug(serverRole)
          const serverPerms = Array.isArray((data as { permissions?: unknown }).permissions)
            ? ((data as { permissions: unknown[] }).permissions.filter((x) => typeof x === 'string') as string[])
            : []
          setEffectiveFullAccess(apiFullAccess)
          if (!apiFullAccess) {
            setEffectivePermissionNames(new Set(serverPerms))
          }
        } else {
          console.warn('Nav: /api/me/effective-permissions unavailable', res.status)
        }
      } catch {
        // Fail closed — items with requiresAnyPermission stay hidden
      } finally {
        setEffectivePermsReady(true)
      }

      // Org branding and legacy user-permission grants still use the Supabase client.
      // These are cosmetic/additive — a null user here is non-fatal.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      let user = session?.user ?? null
      if (!user) {
        const { data: userData } = await supabase.auth.getUser()
        user = userData.user ?? null
      }

      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('role, org_id, custom_role:custom_roles(name, display_name)')
          .eq('id', user.id)
          .single()

        const customRole = Array.isArray((profile as any)?.custom_role)
          ? (profile as any).custom_role[0]
          : (profile as any)?.custom_role
        if (customRole?.name) setCustomRoleName(customRole.name)
        if (customRole?.display_name) setCustomRoleDisplayName(customRole.display_name)

        // Load org info for company name and logo
        if (profile?.org_id) {
          const { data: org, error: orgError } = await supabase
            .from('orgs')
            .select('*')
            .eq('id', profile.org_id)
            .single()

          if (orgError) {
            console.error('Nav: failed to load org branding', orgError)
          }

          if (org) {
            if (org.name) {
              setCompanyName(org.name)
            }
            // Check for logo_url in column or settings
            const logoUrl = org.logo_url || (org.settings as any)?.logo_url
            if (logoUrl) {
              // Add cache-busting timestamp for logo
              const logoWithCacheBust = logoUrl.includes('?')
                ? `${logoUrl}&_t=${Date.now()}`
                : `${logoUrl}?_t=${Date.now()}`
              setCompanyLogo(logoWithCacheBust)
            } else {
              setCompanyLogo(null)
            }
          }
        }

        // Load user-specific permissions (legacy additive grants shown in filter)
        const { data: userPerms } = await supabase
          .from('user_permissions')
          .select('permission_id, permissions(name)')
          .eq('user_id', user.id)

        if (userPerms) {
          const permNames = userPerms
            .map((up: { permissions: { name: string } | { name: string }[] | null }) => {
              if (Array.isArray(up.permissions)) {
                return up.permissions[0]?.name
              }
              return up.permissions?.name
            })
            .filter(Boolean) as string[]
          setUserPermissions(permNames)
        }
      }

      setLoading(false)
    }

    loadUserRoleAndPermissions()
  }, [])

  // Re-fetch org data when navigating away from settings (to pick up changes)
  useEffect(() => {
    const fetchOrgData = async () => {
      if (!supabaseRef.current) return
      
      const { data: { user } } = await supabaseRef.current.auth.getUser()
      if (!user) return

      const { data: profile } = await supabaseRef.current
        .from('users')
        .select('org_id')
        .eq('id', user.id)
        .single()

      if (profile?.org_id) {
        const { data: org } = await supabaseRef.current
          .from('orgs')
          .select('name, logo_url, settings')
          .eq('id', profile.org_id)
          .single()
        
        if (org) {
          if (org.name) {
            setCompanyName(org.name)
          }
          const logoUrl = org.logo_url || org.settings?.logo_url
          if (logoUrl) {
            const logoWithCacheBust = logoUrl.includes('?') 
              ? `${logoUrl}&_t=${Date.now()}` 
              : `${logoUrl}?_t=${Date.now()}`
            setCompanyLogo(logoWithCacheBust)
          } else {
            setCompanyLogo(null)
          }
        }
      }
    }

    // Only re-fetch when navigating away from settings
    if (!pathname.includes('/settings') && !pathname.includes('/admin')) {
      fetchOrgData()
    }
  }, [pathname])

  const handleLogout = async () => {
    try {
      if (!supabaseRef.current) {
        supabaseRef.current = createClientBrowser()
      }
      await supabaseRef.current.auth.signOut()
      // Force redirect to login page
      window.location.href = '/login'
    } catch (error) {
      console.error('Logout error:', error)
      // Still redirect even if signOut fails
      window.location.href = '/login'
    }
  }

  const isOpsOnly = userRole === 'operations'
  const hasFullNavAccess = effectiveFullAccess || isOrgSuperuserRoleSlug(userRole ?? '')
  /** Same shape as SSR guards / centralized RBAC helpers */
  const navPermInput = { fullAccess: hasFullNavAccess, permissionNames: effectivePermissionNames }
  const roleInput = { role: userRole, customRoleName, customRoleDisplayName, permissionNames: effectivePermissionNames }

  // One config decides what shows (lib/nav-config.ts); the flags below are the same helpers the flat nav always used.
  const nav = visibleNav({
    permsReady: effectivePermsReady || hasFullNavAccess,
    role: userRole,
    fullAccess: hasFullNavAccess,
    permissionNames: effectivePermissionNames,
    flags: {
      isOpsOnly,
      canSeeOpsDashboard: canAccessOpsDashboardFromPermissionNames(navPermInput),
      canSeeJobBoard: canAccessJobBoardFromPermissionNames(navPermInput),
      canSeeInsideSales: canViewInsideSalesFollowUp(roleInput),
      projectsBarred: isBarredFromProjectsUi(userRole),
      salesDocBarred: isBarredFromSalesDocAccess(roleInput),
      customerRecords: canAccessCustomerRecordsFromPermissionNames(navPermInput) || canAccessCustomerRecords(userRole),
      reports: canAccessReportsFromPermissionNames(navPermInput) || canAccessReports(userRole || undefined),
      isPayrollAdmin: isPayrollAdminRole(userRole),
    },
  })
  const activeId = activeSectionId(pathname, nav)
  const activeSection = nav.sections.find((s) => s.id === activeId) ?? null
  const [moreOpen, setMoreOpen] = useState(false)
  const canAddPartner = hasFullNavAccess || effectivePermissionNames.has('referral_partners:view')

  // The shell is fixed (sidebar / bottom bar), so pages — which each render <Nav /> themselves — get room via body classes.
  useEffect(() => {
    document.body.classList.add('has-app-shell')
    return () => document.body.classList.remove('has-app-shell')
  }, [])

  const openSearch = () => window.dispatchEvent(new Event('arx:open-search'))
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + '/')

  const sectionIcon: Record<string, LucideIcon> = { today: Home, pipeline: Filter, jobs: Hammer, customers: Users, money: DollarSign, insights: BarChart3 }
  const BOTTOM_SLOTS = 4 // the rest go in "More" so every label stays readable on a phone
  const bottomSections = nav.sections.slice(0, BOTTOM_SLOTS)
  const overflowSections = nav.sections.slice(BOTTOM_SLOTS)
  const homeHref = nav.sections[0]?.href ?? '/today'

  const logo = companyLogo ? (
    <img src={companyLogo} alt={companyName} className="h-9 w-auto max-w-[160px] object-contain" onError={() => setCompanyLogo(null)} />
  ) : (
    <img src="/brand/arx-shield.png" alt="ARX" className="h-8 w-auto flex-shrink-0 object-contain" />
  )

  const linkBase = 'flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium'

  return (
    <>
      {/* Desktop sidebar */}
      <aside aria-label="Main" className="print:hidden fixed inset-y-0 left-0 z-40 hidden w-60 flex-col overflow-y-auto bg-gray-900 text-white md:flex">
        <Link href={homeHref} className="flex min-h-[64px] items-center gap-2 px-4 text-lg font-bold">
          {logo}
          <span className="truncate">{companyName}</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 px-2 pb-4">
          {nav.sections.map((s) => {
            const Icon = sectionIcon[s.id]
            const active = s.id === activeId
            return (
              <div key={s.id}>
                <Link href={s.href} aria-current={active ? 'page' : undefined} className={`${linkBase} ${active ? 'bg-gray-700 text-white' : 'text-gray-200 hover:bg-gray-800'}`}>
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  {s.label}
                </Link>
                {active && s.children.length > 1 && (
                  <div className="ml-8 mt-1 flex flex-col gap-0.5 border-l border-gray-700 pl-2">
                    {s.children.map((c) => (
                      <Link key={c.href} href={c.href} aria-current={isActive(c.href) ? 'page' : undefined} className={`flex min-h-[40px] items-center rounded-md px-2 text-sm ${isActive(c.href) ? 'font-semibold text-white' : 'text-gray-300 hover:text-white'}`}>
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {nav.canvass && (
            <Link href="/canvass" className={`${linkBase} mt-2 text-gray-200 hover:bg-gray-800`}>
              <MapPin className="h-5 w-5 shrink-0" aria-hidden />
              Canvass
            </Link>
          )}
          <div className="mt-auto flex flex-col gap-1 border-t border-gray-700 pt-3">
            <Link href={nav.admin ? '/admin' : '/settings'} className={`${linkBase} text-gray-200 hover:bg-gray-800`}>Settings</Link>
            <Link href="/whats-new" className={`${linkBase} text-gray-200 hover:bg-gray-800`}>What&apos;s new</Link>
            <button onClick={handleLogout} className={`${linkBase} text-left text-gray-200 hover:bg-gray-800`}>Logout</button>
          </div>
        </nav>
      </aside>

      {/* Top bar: search, quick actions, bell (all sizes) */}
      <header className="bg-gray-800 text-white print:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-6">
          <Link href={homeHref} className="flex min-h-[44px] items-center gap-2 md:hidden">
            {logo}
          </Link>
          <button
            onClick={openSearch}
            className="hidden min-h-[44px] w-full max-w-md items-center gap-2 rounded-md bg-gray-700 px-3 text-sm text-gray-200 hover:bg-gray-600 md:flex"
            aria-label="Search"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">Search customers, jobs, phone numbers…</span>
            <kbd className="rounded bg-gray-800 px-1.5 py-0.5 text-sm text-gray-200">⌘K</kbd>
          </button>
          <div className="flex flex-shrink-0 items-center gap-0.5 sm:gap-1">
            <button onClick={openSearch} aria-label="Search" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gray-200 hover:bg-gray-700 md:hidden">
              <Search className="h-5 w-5" aria-hidden />
            </button>
            {canAddPartner && (
              <Link href="/referral-partners?add=1" className="inline-flex min-h-[44px] items-center rounded-md bg-amber-400 px-3 text-sm font-semibold text-gray-900 hover:bg-amber-300" title="Add a Referral Partner">
                + Partner
              </Link>
            )}
            <FeedbackButton />
            <NotificationBell />
          </div>
        </div>
        {/* Phone / tablet: the active section's pages as a scrolling tab strip (desktop has them in the sidebar) */}
        {activeSection && activeSection.children.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-t border-gray-700 px-2 md:hidden" role="tablist" aria-label={activeSection.label}>
            {activeSection.children.map((c) => (
              <Link key={c.href} href={c.href} aria-current={isActive(c.href) ? 'page' : undefined} className={`flex min-h-[44px] shrink-0 items-center border-b-2 px-3 text-sm font-medium ${isActive(c.href) ? 'border-amber-400 text-white' : 'border-transparent text-gray-300'}`}>
                {c.label}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* Phone bottom bar */}
      <nav aria-label="Main" className="print:hidden fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-700 bg-gray-900 pb-[env(safe-area-inset-bottom)] text-white md:hidden">
        {bottomSections.map((s) => {
          const Icon = sectionIcon[s.id]
          const active = s.id === activeId
          return (
            <Link key={s.id} href={s.href} aria-current={active ? 'page' : undefined} className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-sm font-medium ${active ? 'text-amber-300' : 'text-gray-200'}`}>
              <Icon className="h-5 w-5" aria-hidden />
              {s.label}
            </Link>
          )
        })}
        <button onClick={() => setMoreOpen(true)} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-sm font-medium text-gray-200">
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          More
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="More">
          <div className="flex flex-col">
            {[
              ...overflowSections.map((s) => ({ href: s.href, label: s.label })),
              ...(nav.canvass ? [{ href: '/canvass', label: 'Canvass' }] : []),
              { href: nav.admin ? '/admin' : '/settings', label: 'Settings' },
              { href: '/whats-new', label: "What's new" },
            ].map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)} className="flex min-h-[48px] items-center border-b border-surface-line text-ui-base font-medium text-ink">
                {l.label}
              </Link>
            ))}
            <button
              onClick={() => {
                setMoreOpen(false)
                handleLogout()
              }}
              className="flex min-h-[48px] items-center text-left text-ui-base font-medium text-ink"
            >
              Logout
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <GlobalSearch />
      <AnnouncementBanner />
    </>
  )
}
