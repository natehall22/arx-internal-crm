'use client'

import RecordAIContextHelper from '@/components/RecordAIContextHelper'

interface LeadAIHelperProps {
  leadId: string
}

export default function LeadAIHelper({ leadId }: LeadAIHelperProps) {
  return <RecordAIContextHelper context={{ type: 'lead', id: leadId }} />
}
