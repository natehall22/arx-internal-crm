import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sql = read('supabase/migrations/202610290070_contact_scope_setters.sql').split('-- ROLLBACK')[0]

describe('setter / canvasser contact scope (RLS + API)', () => {
  it('only restrictive select policies, on the four contact tables', () => {
    const policies = Array.from(sql.matchAll(/create policy[^;]*;/gi)).map((m) => m[0])
    expect(policies).toHaveLength(4)
    for (const p of policies) {
      expect(p).toMatch(/as restrictive for select to authenticated/i)
      expect(p).toContain('is_setter_canvasser_self()')
    }
    for (const t of ['leads', 'customers', 'opportunities', 'scheduled_appointments']) expect(sql).toMatch(new RegExp(`on public\\.${t} as restrictive`))
  })
  it('the SQL rule covers owned, dropped, closer, knocked, appointment and deal', () => {
    for (const frag of ['owner_user_id', 'pin_attributed_user_id', 'closer_user_id', 'canvass_knocks', 'canvasser_user_id', 'setter_user_id']) expect(sql).toContain(frag)
  })
  it('the service-side helper is not callable by signed-in users', () => {
    expect(sql).toMatch(/revoke all on function public\.my_lead_ids\(uuid, uuid\[\]\) from public, anon, authenticated/)
  })
  it.each([
    'app/api/canvass/data/route.ts',
    'app/api/canvass/leads/viewport/route.ts',
    'app/api/appointments/[id]/route.ts',
    'app/api/leads/[id]/route.ts',
    'app/api/opportunities/[id]/route.ts',
    'app/leads/[id]/LeadView.tsx',
  ])('%s asks the shared contact-scope rule', (f) => {
    expect(read(f)).toContain("@/lib/contact-scope")
  })
  it('the new-lead form no longer reads customers or leads with the browser session', () => {
    const form = read('components/LeadFormWithReferral.tsx')
    expect(form).not.toMatch(/\.from\('(customers|leads|referrals)'\)/)
  })
})
