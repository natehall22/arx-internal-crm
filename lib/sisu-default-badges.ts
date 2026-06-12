import type { BadgeCriteriaType } from '@/lib/types/incentive'

type DefaultBadgeDefinition = {
  name: string
  description: string
  icon_key: string
  color_hex: string
  criteria_type: BadgeCriteriaType
  criteria_value: number | null
  sort_order: number
  image_url: null
}

export const DEFAULT_BADGES: DefaultBadgeDefinition[] = [
  {
    name: 'First Step',
    description: 'Set your first inspection',
    icon_key: 'target',
    color_hex: '#6366F1',
    criteria_type: 'first_inspection_set',
    criteria_value: null,
    sort_order: 0,
    image_url: null,
  },
  {
    name: 'Closer',
    description: 'Close your first deal',
    icon_key: 'trophy',
    color_hex: '#F59E0B',
    criteria_type: 'first_closed_sale',
    criteria_value: null,
    sort_order: 1,
    image_url: null,
  },
  {
    name: 'On Fire',
    description: 'Set 10 inspections in a week',
    icon_key: 'fire',
    color_hex: '#EF4444',
    criteria_type: 'inspections_set_milestone',
    criteria_value: 10,
    sort_order: 2,
    image_url: null,
  },
  {
    name: 'Heat Winner',
    description: 'Win your first Heat',
    icon_key: 'star',
    color_hex: '#F59E0B',
    criteria_type: 'spiff_winner',
    criteria_value: null,
    sort_order: 3,
    image_url: null,
  },
  {
    name: 'Elite',
    description: 'Hit #1 on the leaderboard',
    icon_key: 'crown',
    color_hex: '#8B5CF6',
    criteria_type: 'top_leaderboard',
    criteria_value: null,
    sort_order: 4,
    image_url: null,
  },
  {
    name: 'Machine',
    description: 'Set 25 inspections in a week',
    icon_key: 'lightning',
    color_hex: '#F97316',
    criteria_type: 'inspections_set_milestone',
    criteria_value: 25,
    sort_order: 5,
    image_url: null,
  },
  {
    name: '10 Closes',
    description: 'Close 10 deals this month',
    icon_key: 'diamond',
    color_hex: '#10B981',
    criteria_type: 'closed_sales_milestone',
    criteria_value: 10,
    sort_order: 6,
    image_url: null,
  },
  {
    name: 'Streak',
    description: '4 weeks straight hitting your goal',
    icon_key: 'rocket',
    color_hex: '#3B82F6',
    criteria_type: 'streak_weekly_inspections',
    criteria_value: 4,
    sort_order: 7,
    image_url: null,
  },
]
