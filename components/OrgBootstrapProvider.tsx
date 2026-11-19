'use client'

import type { ReactNode } from 'react'

import { OrgBootstrapContext } from '@/hooks/useOrgFeatures'
import type { OrgBootstrap } from '@/lib/org-bootstrap'

/** Root layout → every useOrgProfile / useOrgFeatures: the company's own words on the first paint (no roofing flash). */
export default function OrgBootstrapProvider({ value, children }: { value: OrgBootstrap | null; children: ReactNode }) {
  return <OrgBootstrapContext.Provider value={value}>{children}</OrgBootstrapContext.Provider>
}
