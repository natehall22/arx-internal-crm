'use client'

import * as React from 'react'

import { Input } from '@/components/ui/field'
import { cn } from '@/lib/cn'

/** Search box + filter controls. Wraps on a phone; the search box always takes a full row there. */
export function FilterBar({ search, onSearch, searchPlaceholder = 'Search', children, className }: { search: string; onSearch: (v: string) => void; searchPlaceholder?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="search">
      <Input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="w-full sm:max-w-xs" />
      {children}
    </div>
  )
}
