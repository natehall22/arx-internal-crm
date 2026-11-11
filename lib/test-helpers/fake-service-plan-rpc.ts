/**
 * Test-only stand-ins for the two service-plan SQL functions (migration 202611110030), over fake-db tables. The real
 * SQL is exercised against Postgres by supabase/tests/run-service-plans.sh; these mirror its rules so the TS callers can
 * be tested in jest: service_plan_save (plan patch + removals [cancel when photos] + kept-visit updates, optimistic
 * updated_at) and service_plan_add_visits (refuses a stale plan version; one row per slot+step; charges beside).
 */
type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let clock = 0
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

export const fakeServicePlanRpc = {
  service_plan_save(args: Record<string, unknown>, t: Tables) {
    const plans = (t.service_plans ??= [])
    const plan = plans.find((p) => p.id === args.p_plan_id && p.org_id === args.p_org_id)
    if (!plan) fail('P0002', 'service plan not found')
    if (args.p_expected_updated_at && plan!.updated_at !== args.p_expected_updated_at) fail('40001', 'service plan changed')
    const patch = { ...(args.p_patch as Row) }
    for (const k of ['id', 'org_id', 'customer_id', 'created_by', 'created_at', 'updated_at']) delete patch[k]
    Object.assign(plan!, patch, { updated_at: stamp() })

    const wo = (t.work_orders ??= [])
    const photos = t.photos ?? []
    const open = (w: Row) => w.org_id === args.p_org_id && w.service_plan_id === args.p_plan_id && w.status === 'scheduled' && !w.completed_at
    let removed = 0
    let cancelled = 0
    for (const id of (args.p_remove as string[]) ?? []) {
      const w = wo.find((x) => x.id === id)
      if (!w || !open(w)) continue
      if (photos.some((p) => p.work_order_id === id && !p.deleted_at)) {
        w.status = 'cancelled'
        cancelled++
      } else {
        wo.splice(wo.indexOf(w), 1)
        removed++
      }
    }
    let updated = 0
    const charges = (t.service_visit_charges ??= [])
    for (const g of (args.p_updates as Array<{ ids: string[]; set: Row; charge?: { price: number | null; taxable: boolean } }>) ?? []) {
      for (const id of g.ids) {
        const w = wo.find((x) => x.id === id)
        if (!w || w.org_id !== args.p_org_id || w.service_plan_id !== args.p_plan_id || w.status !== 'scheduled') continue
        Object.assign(w, g.set)
        updated++
        if (g.charge) {
          const c = charges.find((x) => x.work_order_id === id)
          if (c) Object.assign(c, g.charge)
          else charges.push({ work_order_id: id, org_id: args.p_org_id, ...g.charge })
        }
      }
    }
    return { plan: { ...plan }, removed, cancelled, updated }
  },

  service_plan_add_visits(args: Record<string, unknown>, t: Tables) {
    const plan = (t.service_plans ?? []).find((p) => p.id === args.p_plan_id && p.org_id === args.p_org_id)
    if (!plan || plan.status === 'ended') return -1
    if (args.p_plan_updated_at && plan.updated_at !== args.p_plan_updated_at) return -1
    const wo = (t.work_orders ??= [])
    const charges = (t.service_visit_charges ??= [])
    let n = 0
    for (const r of (args.p_rows as Row[]) ?? []) {
      const step = (r.visit_step as string) ?? 'service'
      if (wo.some((w) => w.org_id === args.p_org_id && w.service_plan_id === plan.id && w.service_planned_date === r.service_planned_date && w.visit_step === step)) continue
      const id = `wo-${wo.length + 1}-${++clock}`
      const { price, taxable, ...cols } = r
      wo.push({
        id,
        work_order_number: `WO-${String(wo.length + 1).padStart(5, '0')}`,
        org_id: args.p_org_id,
        work_order_type: 'service_visit',
        status: 'scheduled',
        priority: 'normal',
        service_plan_id: plan.id,
        customer_id: plan.customer_id,
        property_id: plan.property_id,
        trade: plan.trade,
        created_by: plan.created_by,
        updated_at: stamp(),
        ...cols,
        visit_step: step,
        title: cols.title ?? plan.name,
      })
      charges.push({ work_order_id: id, org_id: args.p_org_id, price: price ?? null, taxable: taxable === true })
      n++
    }
    return n
  },
}
