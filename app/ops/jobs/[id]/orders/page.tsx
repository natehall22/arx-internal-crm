import { redirect } from 'next/navigation'

/**
 * The separate "all orders" list for `job_product_orders` was folded into the job's Materials
 * card on 2026-10-21, when job_cost_lines became the one cost ledger. Old links and bookmarks
 * land on the Materials card instead of a 404.
 */
export default function ProductOrdersPage({ params }: { params: { id: string } }) {
  redirect(`/ops/jobs/${params.id}#materials-section`)
}
