import type { SupabaseClient } from '@supabase/supabase-js'

import { CANCELLED_JOB_STATUS } from '@/lib/job-status'

const ID_CHUNK = 100

/** Long `.in()` lists blow the GET URL limit and PostgREST's 1000-row cap; query in chunks. */
async function inChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await run(ids.slice(i, i + ID_CHUNK))
    if (error) throw error
    out.push(...(data ?? []))
  }
  return out
}

export type ReferredJob = {
  partner_id: string
  job_id: string
  sale_date: string | null
  sale_amount: number
}

/**
 * Jobs sold off opportunities that were "Referred By" a partner. Cancelled jobs are not
 * sales. A partner with no referrals returns an empty list.
 */
export async function loadReferredJobs(
  supabase: SupabaseClient,
  orgId: string,
  partnerIds: string[]
): Promise<{ referredCount: Map<string, number>; jobs: ReferredJob[] }> {
  const referredCount = new Map<string, number>()
  if (partnerIds.length === 0) return { referredCount, jobs: [] }

  const opps = await inChunks<{ id: string; referral_partner_id: string }>(partnerIds, (chunk) =>
    supabase
      .from('opportunities')
      .select('id, referral_partner_id')
      .eq('org_id', orgId)
      .in('referral_partner_id', chunk)
      .limit(5000)
  )

  const partnerByOpp = new Map<string, string>()
  for (const o of opps) {
    partnerByOpp.set(o.id as string, o.referral_partner_id as string)
    referredCount.set(
      o.referral_partner_id as string,
      (referredCount.get(o.referral_partner_id as string) ?? 0) + 1
    )
  }
  if (partnerByOpp.size === 0) return { referredCount, jobs: [] }

  const projects = await inChunks<{ id: string; opportunity_id: string }>(
    Array.from(partnerByOpp.keys()),
    (chunk) =>
      supabase.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('opportunity_id', chunk).limit(5000)
  )
  const partnerByProject = new Map<string, string>()
  for (const p of projects) {
    const partner = partnerByOpp.get(p.opportunity_id as string)
    if (partner) partnerByProject.set(p.id as string, partner)
  }
  if (partnerByProject.size === 0) return { referredCount, jobs: [] }

  const jobs = await inChunks<{ id: string; project_id: string; sale_date: string | null; sale_amount: number | null }>(
    Array.from(partnerByProject.keys()),
    (chunk) =>
      supabase
        .from('production_jobs')
        .select('id, project_id, sale_date, sale_amount')
        .eq('org_id', orgId)
        .in('project_id', chunk)
        .not('sale_date', 'is', null)
        .neq('status', CANCELLED_JOB_STATUS)
        .limit(5000)
  )

  return {
    referredCount,
    jobs: jobs.map((j) => ({
      partner_id: partnerByProject.get(j.project_id as string)!,
      job_id: j.id as string,
      sale_date: (j.sale_date as string | null) ?? null,
      sale_amount: Number(j.sale_amount ?? 0),
    })),
  }
}
