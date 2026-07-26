import {
  getAiChatRecordUrl,
  getAiChatRecordUrlAppendix,
} from '@/lib/ai/chat-record-url'

const SAMPLE_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('chat-record-url', () => {
  it('maps record types to App Router paths', () => {
    expect(getAiChatRecordUrl('lead', SAMPLE_ID)).toBe(`/leads/${SAMPLE_ID}`)
    expect(getAiChatRecordUrl('opportunity', SAMPLE_ID)).toBe(
      `/opportunities/${SAMPLE_ID}`
    )
    expect(getAiChatRecordUrl('project', SAMPLE_ID)).toBe(`/projects/${SAMPLE_ID}`)
    expect(getAiChatRecordUrl('job', SAMPLE_ID)).toBe(`/ops/jobs/${SAMPLE_ID}`)
  })

  it('returns null for invalid type or id', () => {
    expect(getAiChatRecordUrl('general', SAMPLE_ID)).toBeNull()
    expect(getAiChatRecordUrl('lead', 'not-a-uuid')).toBeNull()
    expect(getAiChatRecordUrl('unknown', SAMPLE_ID)).toBeNull()
  })

  it('includes current record URL in appendix when access allows', () => {
    const appendix = getAiChatRecordUrlAppendix(
      { type: 'lead', id: SAMPLE_ID },
      { role: 'sales_rep', fullAccess: false, permissionNames: new Set(['leads:view']) }
    )
    expect(appendix).toContain(`Current record URL: /leads/${SAMPLE_ID}`)
  })

  it('returns empty appendix when RBAC blocks record context', () => {
    const appendix = getAiChatRecordUrlAppendix(
      { type: 'job', id: SAMPLE_ID },
      { role: 'setter', fullAccess: false, permissionNames: new Set(['leads:view']) }
    )
    expect(appendix).toBe('')
  })
})
