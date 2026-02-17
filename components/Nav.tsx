'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
// Include legacy roles for backwards compatibility
type AnyUserRole = 'admin' | 'manager' | 'rep' | 'regional_manager' | 'sales_manager' | 'sales_rep' | 'canvasser' | 'operations'

type NavItem = {
  href: string
  label: string
  roles?: AnyUserRole[] // If specified, only these roles can see this item
  permission?: string // If specified, check for this specific permission
}

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabaseRef = useRef<ReturnType<typeof createClientBrowser> | null>(null)
  const [userRole, setUserRole] = useState<AnyUserRole | null>(null)
  const [userPermissions, setUserPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState<string>('ARX CRM')
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)

  useEffect(() => {
    const loadUserRoleAndPermissions = async () => {
      const supabase = createClientBrowser()
      supabaseRef.current = supabase
      
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('role, org_id')
          .eq('id', user.id)
          .single()
        
        if (profile?.role) {
          setUserRole(profile.role as AnyUserRole)
        }

        // Load org info for company name and logo
        if (profile?.org_id) {
          const { data: org } = await supabase
            .from('orgs')
            .select('name, logo_url, settings')
            .eq('id', profile.org_id)
            .single()
          
          if (org) {
            if (org.name) {
              setCompanyName(org.name)
            }
            // Check for logo_url in column or settings
            const logoUrl = org.logo_url || org.settings?.logo_url
            if (logoUrl) {
              setCompanyLogo(logoUrl)
            }
          }
        }

        // Load user-specific permissions
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

  // Define nav items with role restrictions
  // Include legacy roles (manager, rep) for backwards compatibility
  const allNavItems: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/calendar', label: 'Calendar', roles: ['admin', 'manager', 'regional_manager', 'sales_manager', 'sales_rep', 'rep', 'operations'] },
    { href: '/leads', label: 'Leads' },
    { href: '/opportunities', label: 'Opportunities' },
    { href: '/projects', label: 'Projects', roles: ['admin', 'manager', 'regional_manager', 'sales_manager', 'sales_rep', 'rep', 'operations'] },
    { href: '/ops', label: 'Operations', roles: ['admin', 'regional_manager', 'operations', 'manager'] },
    { href: '/canvass/map', label: 'Canvass' },
    { href: '/pricebook', label: 'Pricebook', roles: ['admin', 'regional_manager', 'operations'], permission: 'pricebook:view' },
    { href: '/customers', label: 'Customers', roles: ['admin', 'manager', 'regional_manager', 'sales_manager', 'sales_rep', 'rep', 'operations'] },
    { href: '/reports', label: 'Reports' },
    { href: '/admin', label: 'Admin', roles: ['admin', 'manager', 'regional_manager'] },
  ]

  // Filter nav items based on user role and permissions
  const navItems = allNavItems.filter(item => {
    // If user has a specific permission grant, always show the item
    if (item.permission && userPermissions.includes(item.permission)) {
      return true
    }
    // Check role-based access
    if (!item.roles) return true // No restriction, show to everyone
    if (!userRole) return true // Still loading, show all for now to prevent flash
    return item.roles.includes(userRole)
  })

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="bg-gray-800 text-white">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Company Logo/Name */}
          <div className="flex-shrink-0">
            <Link href="/dashboard" className="flex items-center gap-2 text-xl font-bold whitespace-nowrap">
              {companyLogo ? (
                <div className="relative w-8 h-8 rounded overflow-hidden bg-white/10">
                  <Image
                    src={companyLogo}
                    alt={companyName}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
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
