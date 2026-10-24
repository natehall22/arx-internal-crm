import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const migration = read('supabase/migrations/202610290030_pipeline_lead_rule.sql').split('-- ROLLBACK')[0]

// "Is this lead in the pipeline" has ONE definition: public.lead_in_pipeline (SQL). Every count/list asks it; none re-implements it.
describe('pipeline lead rule', () => {
  it('the SQL rule covers contact, booked and inbound', () => {
    expect(migration).toMatch(/homeowner_name[\s\S]*phone[\s\S]*email/)
    expect(migration).toContain('scheduled_appointments')
    expect(migration).toContain("channel::text = 'inbound'")
    expect(migration).toMatch(/'yelp'/)
    expect(migration).toMatch(/'referral'/)
  })

  it('reports read the rule from the database function', () => {
    expect(migration).toMatch(/create or replace view rpt_leads[\s\S]*where public\.lead_in_pipeline\(l\)/)
  })

  it.each(['app/api/leads/route.ts', 'app/dashboard/page.tsx', 'lib/ai/chat-aggregates.ts'])('%s filters on lead_in_pipeline', (f) => {
    expect(read(f)).toContain("lead_in_pipeline")
  })

  it('the Leads list no longer carries its own door-to-door filter', () => {
    const api = read('app/api/leads/route.ts')
    expect(api).not.toContain('progressedDoorToDoorStatuses')
    expect(api).not.toContain('leadIdsWithScheduledAppointment')
  })
})
