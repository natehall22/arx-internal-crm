import type { RoleGroup } from '@/lib/announcements'

/**
 * A few phone screenshots per role on /whats-new, so people can see where things are. Files live in /public/whats-new.
 * Announcements only: never a screenshot or copy of a live work box like "Needs you" (that is role-restricted and
 * shown only where the server decides — lib/data-health.ts). A test keeps it that way.
 */
export const WHATS_NEW_SHOTS: Partial<Record<RoleGroup, Array<{ file: string; caption: string }>>> = {
  owner: [
    { file: 'suppliers-admin-default.png', caption: 'Settings → Suppliers: add ABC’s order email' },
    { file: 'reports-explore-chart.png', caption: 'Reports: start from a template' },
  ],
  ops: [{ file: 'supplier-orders-default.png', caption: 'Each supplier gets its own purchase order' }],
  closer: [{ file: 'sale-credit-confirm-credit-step.png', caption: 'Confirm setter and closer credit when the contract is signed' }],
}
