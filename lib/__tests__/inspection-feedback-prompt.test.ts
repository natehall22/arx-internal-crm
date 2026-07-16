import {
  FEEDBACK_PROMPT_ESCALATION_THRESHOLD,
  isPromptDue,
  isPromptEscalated,
} from '@/lib/inspection-feedback-prompt'

describe('inspection feedback prompt timing and escalation', () => {
  it('locks exactly at the configured snooze threshold', () => {
    expect(isPromptEscalated(FEEDBACK_PROMPT_ESCALATION_THRESHOLD - 1)).toBe(false)
    expect(isPromptEscalated(FEEDBACK_PROMPT_ESCALATION_THRESHOLD)).toBe(true)
  })

  it('requires both the appointment and prompt timer to be due', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z')

    expect(
      isPromptDue(
        {
          prompt_at: '2026-07-16T11:00:00.000Z',
          appointment: { scheduled_for: '2026-07-16T10:00:00.000Z' },
        },
        now
      )
    ).toBe(true)
    expect(
      isPromptDue(
        {
          prompt_at: '2026-07-16T13:00:00.000Z',
          appointment: { scheduled_for: '2026-07-16T10:00:00.000Z' },
        },
        now
      )
    ).toBe(false)
  })
})
