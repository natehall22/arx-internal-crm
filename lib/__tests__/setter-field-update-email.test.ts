import {
  buildSetterFieldUpdateHtml,
  calculateSessionCappedTif,
  isTifContactDisposition,
  resolveRecipientManagedTeamIds,
  summarizeSetterFieldRows,
  type SetterFieldUpdateReport,
} from '../setter-field-update-email'

describe('setter field-time update', () => {
  it('excludes gaps longer than 15 minutes as breaks', () => {
    const result = calculateSessionCappedTif([
      { at: '2026-08-10T14:00:00Z', contact: false },
      { at: '2026-08-10T14:10:00Z', contact: false },
      { at: '2026-08-10T15:10:00Z', contact: false },
    ])
    expect(result.sessionCount).toBe(2)
    expect(result.activeElapsedMinutes).toBe(20)
    expect(result.creditedMinutes).toBe(15)
  })

  it('subtracts multiple breaks from the same day', () => {
    const result = calculateSessionCappedTif([
      { at: '2026-08-10T14:00:00Z', contact: false },
      { at: '2026-08-10T14:05:00Z', contact: false },
      { at: '2026-08-10T15:00:00Z', contact: false },
      { at: '2026-08-10T15:10:00Z', contact: false },
      { at: '2026-08-10T16:00:00Z', contact: false },
    ])
    expect(result.sessionCount).toBe(3)
    expect(result.activeElapsedMinutes).toBe(30)
    expect(result.creditedMinutes).toBe(25)
  })

  it('lets a contact stretch a gap to 30 minutes without breaking the session', () => {
    const result = calculateSessionCappedTif([
      { at: '2026-08-10T14:00:00Z', contact: false },
      { at: '2026-08-10T14:30:00Z', contact: true },
    ])
    expect(result.sessionCount).toBe(1)
    expect(result.creditedMinutes).toBe(25)
  })

  it('still breaks a multi-hour gap that sits next to a contact', () => {
    const result = calculateSessionCappedTif([
      { at: '2026-08-10T17:06:00Z', contact: true },
      { at: '2026-08-10T19:46:00Z', contact: true },
    ])
    // The 160-minute gap is a break, not a 160-minute conversation.
    expect(result.sessionCount).toBe(2)
    expect(result.activeElapsedMinutes).toBe(40)
    expect(result.creditedMinutes).toBe(40)
  })

  it('treats renters as a quick door rather than a contact', () => {
    const contactIds = new Set(['renter', 'go_back', 'hot_lead', 'not_interested'])
    expect(isTifContactDisposition('renter', contactIds)).toBe(false)
    expect(isTifContactDisposition('not_interested', contactIds)).toBe(true)

    const rows = summarizeSetterFieldRows(
      [
        {
          id: '1', created_at: '2026-08-10T14:00:00Z', source: 'canvass',
          canvass_disposition: 'renter', owner_user_id: 'rep', pin_attributed_user_id: null,
        },
        {
          id: '2', created_at: '2026-08-10T14:04:00Z', source: 'canvass',
          canvass_disposition: 'not_interested', owner_user_id: 'rep', pin_attributed_user_id: null,
        },
      ],
      [{ id: 'rep', full_name: 'Field Rep', team_id: 'east' }],
      contactIds
    )
    expect(rows[0]).toEqual(expect.objectContaining({ doors: 2, contacts: 1, nonContacts: 1, creditedMinutes: 24 }))
  })

  it('recognizes an admin as a manager through direct-report assignments', () => {
    const teams = resolveRecipientManagedTeamIds(
      { id: 'admin-manager', role: 'admin' },
      [
        { id: 'admin-manager', team_id: 'east', manager_user_id: null },
        { id: 'rep', team_id: 'east', manager_user_id: 'admin-manager' },
      ]
    )
    expect(Array.from(teams)).toEqual(['east'])
  })

  it('groups attributed knocks per rep and Eastern day', () => {
    const rows = summarizeSetterFieldRows(
      [
        {
          id: '1', created_at: '2026-08-10T14:00:00Z', source: 'canvass',
          canvass_disposition: 'not_home', owner_user_id: 'rep', pin_attributed_user_id: null,
        },
        {
          id: '2', created_at: '2026-08-10T14:10:00Z', source: 'canvass',
          canvass_disposition: 'hot_lead', owner_user_id: 'other', pin_attributed_user_id: 'rep',
        },
      ],
      [{ id: 'rep', full_name: 'Field Rep', team_id: 'east' }],
      new Set(['hot_lead'])
    )

    expect(rows).toEqual([
      expect.objectContaining({
        repName: 'Field Rep',
        teamId: 'east',
        doors: 2,
        contacts: 1,
        nonContacts: 1,
        creditedMinutes: 25,
        firstKnockAt: '2026-08-10T14:00:00Z',
        lastKnockAt: '2026-08-10T14:10:00Z',
      }),
    ])
  })

  it('renders the team name and includes managers/admins when they have team rows', () => {
    const report: SetterFieldUpdateReport = {
      teamId: 'east',
      teamName: 'East Charlotte',
      sentDateLabel: 'Tuesday, August 11, 2026',
      activityLabel: 'Monday, August 10, 2026',
      activityKind: 'yesterday',
      rows: [
        {
          dateKey: '2026-08-10', dateLabel: 'Monday, Aug 10', userId: 'manager',
          teamId: 'east', repName: 'Admin Manager', firstKnockAt: '2026-08-10T14:00:00Z',
          lastKnockAt: '2026-08-10T15:00:00Z', doors: 10, contacts: 3, nonContacts: 7,
          creditedMinutes: 74,
        },
      ],
    }
    const html = buildSetterFieldUpdateHtml(report)
    expect(html).toContain('East Charlotte Setter Time In Field (TIF) Update')
    expect(html).toContain('a gap next to a contact gets 30 minutes before it counts as a break')
    expect(html).toContain('Renters count as a quick door (5 minutes), not a contact')
    expect(html).toContain('non-contacts count as 5 minutes')
    expect(html).toContain('Last knock')
    expect(html).toContain('Admin Manager')
    expect(html).toContain('1.2 hr')
  })
})
