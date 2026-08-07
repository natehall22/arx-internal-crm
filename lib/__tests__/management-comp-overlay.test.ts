import {
  resolveManagementCompOverlays,
  type EffectiveManagementOverlayAssignment,
  type EffectiveManagerAssignment,
  type ManagementOverlayPlanVersion,
} from '@/lib/management-comp-overlay'

const SALE_DATE = '2026-08-07'

const links: EffectiveManagerAssignment[] = [
  {
    id: 'setter-link',
    userId: 'setter',
    managerUserId: 'setter-manager',
    effectiveFrom: '2026-08-01',
    effectiveTo: null,
  },
  {
    id: 'closer-link',
    userId: 'closer',
    managerUserId: 'sales-manager',
    effectiveFrom: '2026-08-01',
    effectiveTo: null,
  },
]

const overlays: EffectiveManagementOverlayAssignment[] = [
  {
    assignmentId: 'setter-overlay',
    managerUserId: 'setter-manager',
    compPlanId: 'setter-plan',
    lane: 'setter',
    effectiveFrom: '2026-08-01',
    effectiveTo: null,
  },
  {
    assignmentId: 'closer-overlay',
    managerUserId: 'sales-manager',
    compPlanId: 'closer-plan',
    lane: 'closer',
    effectiveFrom: '2026-08-01',
    effectiveTo: null,
  },
]

const versions: ManagementOverlayPlanVersion[] = [
  {
    versionId: 'setter-v1',
    compPlanId: 'setter-plan',
    lane: 'setter',
    ratePercent: 1,
    effectiveFrom: '2026-08-01',
  },
  {
    versionId: 'closer-v1',
    compPlanId: 'closer-plan',
    lane: 'closer',
    ratePercent: 1,
    effectiveFrom: '2026-08-01',
  },
]

describe('resolveManagementCompOverlays', () => {
  it('resolves setter and closer lanes independently on the sale date', () => {
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter',
      closerProducerUserId: 'closer',
      managerAssignments: links,
      overlayAssignments: overlays,
      planVersions: versions,
    })

    expect(result.issues).toEqual([])
    expect(result.lines).toEqual([
      expect.objectContaining({
        lane: 'setter',
        producerUserId: 'setter',
        recipientUserId: 'setter-manager',
        managerAssignmentId: 'setter-link',
        overlayVersionId: 'setter-v1',
        source: 'direct_report',
      }),
      expect.objectContaining({
        lane: 'closer',
        producerUserId: 'closer',
        recipientUserId: 'sales-manager',
        managerAssignmentId: 'closer-link',
        overlayVersionId: 'closer-v1',
        source: 'direct_report',
      }),
    ])
  })

  it('allows the same recipient to receive both lanes without collapsing either line', () => {
    const sharedLinks = links.map((row) => ({ ...row, managerUserId: 'manager' }))
    const sharedOverlays = overlays.map((row) => ({ ...row, managerUserId: 'manager' }))
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter',
      closerProducerUserId: 'closer',
      managerAssignments: sharedLinks,
      overlayAssignments: sharedOverlays,
      planVersions: versions,
    })

    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((line) => line.lane)).toEqual(['setter', 'closer'])
    expect(result.lines.every((line) => line.recipientUserId === 'manager')).toBe(true)
  })

  it('pays a manager their lane overlay on their own production', () => {
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter-manager',
      closerProducerUserId: null,
      managerAssignments: links,
      overlayAssignments: overlays,
      planVersions: versions,
    })

    expect(result.lines).toEqual([
      expect.objectContaining({
        lane: 'setter',
        producerUserId: 'setter-manager',
        recipientUserId: 'setter-manager',
        managerAssignmentId: null,
        source: 'own_production',
      }),
    ])
  })

  it('stops own-production manager pay after the last direct report ends', () => {
    const result = resolveManagementCompOverlays({
      saleDate: '2026-09-01',
      setterProducerUserId: 'setter-manager',
      managerAssignments: links.map((row) =>
        row.managerUserId === 'setter-manager' ? { ...row, effectiveTo: '2026-08-31' } : row
      ),
      overlayAssignments: overlays,
      planVersions: versions,
    })

    expect(result).toEqual({ lines: [], issues: [] })
  })

  it('supports explicit suppression independently for each lane', () => {
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter',
      closerProducerUserId: 'closer',
      managerAssignments: links,
      overlayAssignments: overlays,
      planVersions: versions,
      suppressedLanes: ['setter'],
    })

    expect(result.lines.map((line) => line.lane)).toEqual(['closer'])
  })

  it('uses the hierarchy and overlay versions effective on the sale date', () => {
    const result = resolveManagementCompOverlays({
      saleDate: '2026-07-15',
      setterProducerUserId: 'setter',
      managerAssignments: [
        {
          id: 'old-link',
          userId: 'setter',
          managerUserId: 'old-manager',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-31',
        },
        ...links,
      ],
      overlayAssignments: [
        {
          assignmentId: 'old-overlay',
          managerUserId: 'old-manager',
          compPlanId: 'old-plan',
          lane: 'setter',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-31',
        },
        ...overlays,
      ],
      planVersions: [
        {
          versionId: 'old-v1',
          compPlanId: 'old-plan',
          lane: 'setter',
          ratePercent: 0.75,
          effectiveFrom: '2026-07-01',
        },
        ...versions,
      ],
    })

    expect(result.lines[0]).toMatchObject({
      recipientUserId: 'old-manager',
      ratePercent: 0.75,
      managerAssignmentId: 'old-link',
      overlayVersionId: 'old-v1',
    })
  })

  it('leaves a lane blank when no direct manager or matching overlay exists', () => {
    expect(
      resolveManagementCompOverlays({
        saleDate: SALE_DATE,
        setterProducerUserId: 'unmanaged-setter',
        managerAssignments: links,
        overlayAssignments: overlays,
        planVersions: versions,
      })
    ).toEqual({ lines: [], issues: [] })

    expect(
      resolveManagementCompOverlays({
        saleDate: SALE_DATE,
        setterProducerUserId: 'setter',
        managerAssignments: links,
        overlayAssignments: overlays.filter((row) => row.lane !== 'setter'),
        planVersions: versions,
      })
    ).toEqual({ lines: [], issues: [] })
  })

  it('never pays an inactive direct manager and does not roll beyond direct reports', () => {
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter',
      managerAssignments: [
        ...links,
        {
          id: 'manager-to-regional',
          userId: 'setter-manager',
          managerUserId: 'regional-manager',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        },
      ],
      overlayAssignments: [
        ...overlays,
        {
          assignmentId: 'regional-setter-overlay',
          managerUserId: 'regional-manager',
          compPlanId: 'setter-plan',
          lane: 'setter',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        },
      ],
      planVersions: versions,
      userActiveHistory: [
        { userId: 'setter-manager', isActive: false, effectiveFrom: '2026-01-01' },
      ],
    })

    expect(result).toEqual({ lines: [], issues: [] })
  })

  it('does not pay an inactive manager on their own production', () => {
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter-manager',
      managerAssignments: links,
      overlayAssignments: overlays,
      planVersions: versions,
      userActiveHistory: [
        { userId: 'setter-manager', isActive: false, effectiveFrom: '2026-01-01' },
      ],
    })

    expect(result).toEqual({ lines: [], issues: [] })
  })

  it('fails the affected lane closed on overlapping hierarchy rows', () => {
    const result = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter',
      closerProducerUserId: 'closer',
      managerAssignments: [
        ...links,
        { ...links[0], id: 'conflicting-link', managerUserId: 'other-manager' },
      ],
      overlayAssignments: overlays,
      planVersions: versions,
    })

    expect(result.lines.map((line) => line.lane)).toEqual(['closer'])
    expect(result.issues).toContainEqual({
      lane: 'setter',
      code: 'ambiguous_manager_assignment',
      userId: 'setter',
    })
  })

  it('fails the affected lane closed on overlapping overlay versions or invalid rates', () => {
    const ambiguous = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      setterProducerUserId: 'setter',
      managerAssignments: links,
      overlayAssignments: [
        ...overlays,
        { ...overlays[0], assignmentId: 'duplicate-overlay' },
      ],
      planVersions: versions,
    })
    expect(ambiguous.lines).toEqual([])
    expect(ambiguous.issues[0]?.code).toBe('ambiguous_overlay_assignment')

    const invalid = resolveManagementCompOverlays({
      saleDate: SALE_DATE,
      closerProducerUserId: 'closer',
      managerAssignments: links,
      overlayAssignments: overlays,
      planVersions: versions.map((row) =>
        row.lane === 'closer' ? { ...row, ratePercent: Number.NaN } : row
      ),
    })
    expect(invalid.lines).toEqual([])
    expect(invalid.issues[0]?.code).toBe('invalid_overlay_rate')
  })

  it('fails all lanes closed for a missing or impossible sale date', () => {
    for (const saleDate of [null, '2026-02-30', 'not-a-date']) {
      const result = resolveManagementCompOverlays({
        saleDate,
        setterProducerUserId: 'setter',
        closerProducerUserId: 'closer',
        managerAssignments: links,
        overlayAssignments: overlays,
        planVersions: versions,
      })
      expect(result.lines).toEqual([])
      expect(result.issues).toEqual([
        { lane: null, code: 'invalid_sale_date', userId: null },
      ])
    }
  })

  it('resolves append-only plan versions without changing historical sales', () => {
    const versionHistory: ManagementOverlayPlanVersion[] = [
      { ...versions[0], versionId: 'setter-v1', ratePercent: 1, effectiveFrom: '2026-08-01' },
      { ...versions[0], versionId: 'setter-v2', ratePercent: 1.25, effectiveFrom: '2026-09-01' },
    ]
    const base = {
      setterProducerUserId: 'setter',
      managerAssignments: links,
      overlayAssignments: overlays,
      planVersions: versionHistory,
    }

    expect(resolveManagementCompOverlays({ ...base, saleDate: '2026-08-31' }).lines[0]).toMatchObject({
      ratePercent: 1,
      overlayVersionId: 'setter-v1',
    })
    expect(resolveManagementCompOverlays({ ...base, saleDate: '2026-09-01' }).lines[0]).toMatchObject({
      ratePercent: 1.25,
      overlayVersionId: 'setter-v2',
    })
  })
})
