'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'
import { isBarredFromProjectsUi } from '@/lib/permissions'
import NotificationBell from './NotificationBell'
import FeedbackButton from './FeedbackButton'
// Include legacy roles for backwards compatibility
type AnyUserRole =
  | 'admin'
  | 'owner'
  | 'manager'
  | 'regional_manager'
  | 'regional_setter_manager'
  | 'sales_manager'
  | 'setter_manager'
  | 'sales_rep'
  | 'setter'
  | 'rep'
  | 'closer'
  | 'inside_sales'
  | 'canvasser'
  | 'operations'
  | 'custom'

type NavItem = {
  href: string
  label: string
  permission?: string // If specified, check for this specific permission
  /** Temporary route-alignment guard for pages that are still server role-gated instead of permission-gated. */
  requiresAnyRole?: AnyUserRole[]
  /** Must have this permission name (from role matrix, custom role, or user grant) — used for Canvass vs lead-only workflows */
  requiresAnyPermission?: string | string[]
}

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabaseRef = useRef<ReturnType<typeof createClientBrowser> | null>(null)
  const [userRole, setUserRole] = useState<AnyUserRole | null>(null)
  const [userPermissions, setUserPermissions] = useState<string[]>([])
  const [effectivePermsReady, setEffectivePermsReady] = useState(false)
  const [effectiveFullAccess, setEffectiveFullAccess] = useState(false)
  const [effectivePermissionNames, setEffectivePermissionNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState<string>('ARX CRM')
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)

  const normalizeRole = (role: unknown): AnyUserRole | null => {
    const normalized = String(role || '').toLowerCase().trim()
    return normalized ? (normalized as AnyUserRole) : null
  }

  useEffect(() => {
    const loadUserRoleAndPermissions = async () => {
      const supabase = createClientBrowser()
      supabaseRef.current = supabase

      // Always fetch effective permissions from the server — don't gate on the
      // Supabase browser client, which can't read HttpOnly session cookies.
      try {
        const res = await fetch('/api/me/effective-permissions')
        const data = await res.json().catch(() => null)
        if (res.ok && data && typeof data === 'object') {
          const serverRole = normalizeRole(data.role)
          if (serverRole) {
            setUserRole(serverRole)
          }
          setEffectiveFullAccess(Boolean(data.fullAccess))
          setEffectivePermissionNames(
            new Set(Array.isArray(data.permissions) ? data.permissions.filter((x: unknown) => typeof x === 'string') : [])
          )
        }
      } catch {
        // Fail closed — items with requiresAnyPermission stay hidden
      } finally {
        setEffectivePermsReady(true)
      }

      // Org branding and legacy user-permission grants still use the Supabase client.
      // These are cosmetic / additive so a null user here is non-fatal.
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('role, org_id')
          .eq('id', user.id)
          .single()

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

        // Load user-specific permissions (legacy additive grants)
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

  // Determine which dashboard to show based on role
  // Ops-only users go to ops dashboard, others go to sales dashboard
  // Admin and managers see both
  const isOpsOnly = userRole === 'operations'
  const hasOpsAccess = userRole ? ['admin', 'regional_manager', 'operations', 'manager', 'owner'].includes(userRole) : false
  const hasSalesAccess = userRole ? userRole !== 'operations' : true // Default to sales dashboard while loading

  // Define nav items with role restrictions
  // Include legacy roles (manager, rep) for backwards compatibility
  // Canvassers have limited access: Dashboard, Leads, Canvass only
  const allNavItems: NavItem[] = [
    // Sales dashboard - shown to everyone except ops-only users
    ...(hasSalesAccess ? [{ href: '/dashboard', label: 'Dashboard' }] : []),
    // Ops dashboard - shown to ops users and admins/managers
    ...(hasOpsAccess ? [{ href: '/ops/dashboard', label: isOpsOnly ? 'Dashboard' : 'Ops Dashboard', requiresAnyRole: ['admin', 'regional_manager', 'operations', 'manager', 'owner'] as AnyUserRole[] }] : []),
    { href: '/calendar', label: 'Calendar', requiresAnyPermission: ['scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region', 'scheduling:manage_queue'] },
    { href: '/leads', label: 'Leads', requiresAnyPermission: ['leads:view', 'leads:create', 'leads:edit', 'leads:view_inbound', 'leads:manage_inbound', 'leads:claim_inbound'] },
    { href: '/opportunities', label: 'Opportunities', requiresAnyPermission: ['opportunities:view', 'opportunities:edit'] },
    {
      href: '/projects',
      label: 'Projects',
      requiresAnyPermission: ['projects:view', 'projects:edit'],
    },
    { href: '/ops', label: 'Job Board', requiresAnyRole: ['admin', 'operations', 'owner'] },
    {
      href: '/canvass',
      label: 'Canvass',
      requiresAnyPermission: 'canvass:view',
    },
    { href: '/pricebook', label: 'Pricebook', requiresAnyPermission: ['pricebook:view', 'pricebook:edit'] },
    { href: '/customers', label: 'Customers', requiresAnyPermission: ['customers:view', 'customers:edit'] },
    { href: '/reports', label: 'Reports', requiresAnyPermission: ['reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:view_all'] },
    { href: '/admin', label: 'Admin', requiresAnyPermission: ['admin:access', 'admin:roles', 'admin:permissions', 'admin:settings'] },
  ]

  // Filter nav items based on user role and permissions
  const navItems = allNavItems.filter(item => {
    if (item.href === '/projects') {
      if (isBarredFromProjectsUi(userRole)) return false
    }
    if (item.href === '/opportunities' && (userRole === 'setter' || userRole === 'canvasser')) {
      return false
    }

    if (item.requiresAnyRole) {
      if (!userRole) return false
      if (effectiveFullAccess) return true
      return item.requiresAnyRole.includes(userRole)
    }

    if (item.requiresAnyPermission) {
      if (!effectivePermsReady) return false
      const required = Array.isArray(item.requiresAnyPermission) ? item.requiresAnyPermission : [item.requiresAnyPermission]
      if (!(effectiveFullAccess || required.some((permission) => effectivePermissionNames.has(permission)))) return false
      if (item.href === '/projects' && isBarredFromProjectsUi(userRole)) return false
      return true
    }

    // If user has a specific permission grant, always show the item
    if (
      item.permission &&
      (effectiveFullAccess || userPermissions.includes(item.permission) || effectivePermissionNames.has(item.permission))
    ) {
      return true
    }

    return true
  })

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="bg-gray-800 text-white">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Company Logo/Name */}
          <div className="flex-shrink-0">
            <Link href={isOpsOnly ? '/ops/dashboard' : '/dashboard'} className="flex items-center gap-2 text-xl font-bold whitespace-nowrap">
              {companyLogo ? (
                <img
                  src={companyLogo}
                  alt={companyName}
                  className="h-10 sm:h-11 w-auto max-w-[180px] object-contain"
                  onError={(e) => {
                    console.error('Logo failed to load:', companyLogo)
                    setCompanyLogo(null)
                  }}
                />
              ) : null}
              <span className="hidden sm:inline">{companyName}</span>
              {/* Show abbreviated name on very small screens if no logo */}
              {!companyLogo && (
                <span className="sm:hidden">
                  {companyName.length > 10 ? companyName.substring(0, 10) + '...' : companyName}
                </span>
              )}
            </Link>
          </div>

          {/* Desktop nav - scrollable */}
          <div className="hidden md:flex flex-1 items-center justify-center min-w-0 mx-4">
            <div className="flex items-center space-x-1 overflow-x-auto scrollbar-hide max-w-full px-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap flex-shrink-0 ${
                    pathname === item.href || pathname?.startsWith(item.href + '/')
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right side icons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Link
              href="/settings"
              className="p-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-full"
              title="My Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
            <FeedbackButton />
            <NotificationBell />
            <button
              onClick={handleLogout}
              className="hidden sm:block px-3 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded-md whitespace-nowrap"
            >
              Logout
            </button>
            
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-md"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-700">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  pathname === item.href || pathname?.startsWith(item.href + '/')
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <button
              onClick={() => {
                setMobileMenuOpen(false)
                handleLogout()
              }}
              className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-gray-300 hover:bg-gray-700 hover:text-white sm:hidden"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
