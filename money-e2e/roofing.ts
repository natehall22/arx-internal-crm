/** Roofing (ARX-like) seeding: customer -> opportunity -> proposal -> project -> signed contract -> production job, the rows signing leaves behind. */
import { randomUUID } from 'node:crypto'

import { admin, must, type Company } from './world'

export type RoofingDeal = { customerId: string; opportunityId: string; projectId: string; proposalId: string; contractId: string; jobId: string; jobNumber: string }

export async function seedSignedRoofingJob(co: Company, p: { n: number; contractTotal: number; salesTax: number; saleDate?: string; customerName?: string; email?: string }): Promise<RoofingDeal> {
  const db = admin()
  const jobNumber = `26-${String(9000 + p.n)}`
  const customer = await must(db.from('customers').insert({ org_id: co.id, name: p.customerName ?? 'Pat Homeowner', email: p.email ?? `pat${p.n}@example.test`, phone: '7045550142', address_text: `${p.n} Oak St, Concord, NC 28027` }).select('id').single(), 'customer')
  const customerId = (customer as { id: string }).id
  const opp = await must(db.from('opportunities').insert({ org_id: co.id, customer_id: customerId, address_text: `${p.n} Oak St, Concord, NC 28027`, owner_user_id: co.ownerId }).select('id').single(), 'opportunity')
  const opportunityId = (opp as { id: string }).id
  const proposal = await must(db.from('proposals').insert({ org_id: co.id, created_by: co.ownerId, customer_name: p.customerName ?? 'Pat Homeowner', customer_address: `${p.n} Oak St`, proposal_number: `P-9${p.n}`, opportunity_id: opportunityId, tax_amount: p.salesTax, status: 'accepted' }).select('id').single(), 'proposal')
  const proposalId = (proposal as { id: string }).id
  const project = await must(db.from('projects').insert({ org_id: co.id, opportunity_id: opportunityId, status: 'in_progress' }).select('id').single(), 'project')
  const projectId = (project as { id: string }).id
  const contract = await must(db.from('order_form_contracts').insert({ org_id: co.id, customer_name: p.customerName ?? 'Pat Homeowner', project_address: `${p.n} Oak St`, agreement_type: 'installation', status: 'completed', project_cost: p.contractTotal, proposal_id: proposalId, opportunity_id: opportunityId, customer_signed_at: new Date().toISOString() }).select('id').single(), 'contract')
  const contractId = (contract as { id: string }).id
  const job = await must(db.from('production_jobs').insert({ org_id: co.id, project_id: projectId, customer_id: customerId, job_number: jobNumber, address_text: `${p.n} Oak St, Concord, NC 28027`, created_by: co.ownerId, status: 'sold', sale_date: p.saleDate ?? '2026-11-05', linked_proposal_id: proposalId, job_type: 'roofing' }).select('id').single(), 'job')
  return { customerId, opportunityId, projectId, proposalId, contractId, jobId: (job as { id: string }).id, jobNumber }
}

export async function signChangeOrder(co: Company, d: RoofingDeal, p: { coNumber: string; original: number; updated: number; commissionable?: boolean }): Promise<string> {
  const row = await must(
    admin().from('job_change_orders').insert({ org_id: co.id, project_id: d.projectId, job_id: d.jobId, co_number: p.coNumber, description: 'Added decking', customer_print_name: 'Pat Homeowner', customer_signature_data: 'x', rep_name: 'Owner', rep_signature_data: 'x', original_amount: p.original, updated_total: p.updated, status: 'completed', is_commissionable: p.commissionable ?? true }).select('id').single(),
    'change order'
  )
  return (row as { id: string }).id
}
export const uuid = () => randomUUID()
