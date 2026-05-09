import {
  DEFAULT_CLOSE_OUTCOMES,
  getCloseOutcomeAction,
  getCloseOutcomeInsideSalesHandoff,
  normalizeCloseOutcomeRows,
} from '@/lib/close-outcomes'
import { DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS } from '@/lib/inspection-outcomes'

describe('close outcome routing settings', () => {
  it('keeps reserved final outcomes backward compatible', () => {
    expect(getCloseOutcomeAction(DEFAULT_CLOSE_OUTCOMES, 'sold')).toBe('won')
    expect(getCloseOutcomeAction(DEFAULT_CLOSE_OUTCOMES, 'said_no')).toBe('lost')
  })

  it('normalizes legacy non-final close outcomes into delayed inside-sales handoffs', () => {
    const rows = normalizeCloseOutcomeRows([
      {
        id: 'needs_another_visit',
        label: 'Needs Another Visit',
        description: 'Requires a follow-up close appointment',
        color: '#3b82f6',
        icon: 'R',
        active: true,
        converts_to_opportunity: false,
        sort_order: 0,
      },
    ])

    expect(rows[0].close_action).toBe('none')
    expect(getCloseOutcomeInsideSalesHandoff(rows, 'needs_another_visit')).toEqual({
      enabled: true,
      delayDays: DEFAULT_INSIDE_SALES_HANDOFF_DELAY_DAYS,
    })
  })

  it('supports custom future close outcomes without reserved ids', () => {
    const rows = normalizeCloseOutcomeRows([
      {
        id: 'customer_thinking_it_over',
        label: 'Customer Thinking It Over',
        description: 'Needs a little time',
        color: '#f59e0b',
        icon: '?',
        active: true,
        converts_to_opportunity: false,
        inside_sales_handoff_delay_days: 5,
        sort_order: 0,
      },
    ])

    expect(getCloseOutcomeAction(rows, 'customer_thinking_it_over')).toBe('none')
    expect(getCloseOutcomeInsideSalesHandoff(rows, 'customer_thinking_it_over')).toEqual({
      enabled: true,
      delayDays: 5,
    })
  })
})
