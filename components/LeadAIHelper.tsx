'use client'

import AIAssistantWrapper from './AIAssistantWrapper'

interface LeadAIHelperProps {
  leadId: string
}

export default function LeadAIHelper({ leadId }: LeadAIHelperProps) {
  return <AIAssistantWrapper context={{ type: 'lead', id: leadId }} />
}
