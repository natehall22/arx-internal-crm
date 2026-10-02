import { MANUAL_LEAD_SOURCES, leadSourceEditOptions, leadSourceLabel } from '@/lib/lead-sources'
import { resolveLeadChannel } from '@/lib/goals-channel-attribution'

describe('lead sources', () => {
  it('offers Yelp on the New Lead form', () => {
    expect(MANUAL_LEAD_SOURCES.map((s) => s.value)).toContain('yelp')
    expect(leadSourceLabel('yelp')).toBe('Yelp')
  })

  it('edit options keep every stored value so saving never nulls the source', () => {
    const opts = leadSourceEditOptions('canvass')
    for (const v of ['canvass', 'csv_import', 'door_to_door', 'call_in', 'referral', 'yelp', 'other']) {
      expect(opts).toContain(v)
    }
    expect(leadSourceEditOptions('Website Contact Form')).toContain('Website Contact Form')
    expect(new Set(leadSourceEditOptions('yelp')).size).toBe(leadSourceEditOptions('yelp').length)
  })

  it('unknown free-text sources label as themselves', () => {
    expect(leadSourceLabel('Website Instant Estimate')).toBe('Website Instant Estimate')
    expect(leadSourceLabel('door_to_door')).toBe('Door to door')
  })

  it('counts Yelp leads as inside sales in goals', () => {
    expect(resolveLeadChannel({ source: 'yelp' })).toBe('inside_sales')
  })
})
