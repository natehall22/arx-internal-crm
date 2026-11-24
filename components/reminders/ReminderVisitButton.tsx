'use client'

import { useRouter } from 'next/navigation'

import OneOffVisit from '@/components/service-plans/OneOffVisit'

/** "Make a visit" on a reminder row: the existing one-off visit sheet, filled in from the reminder; saving also finishes the reminder. */
export function ReminderVisitButton({ reminderId, customerId, propertyId, date, today, text }: { reminderId: string; customerId: string; propertyId: string | null; date: string; today: string; text: string }) {
  const router = useRouter()
  return (
    <OneOffVisit
      prefill={{ reminderId, customerId, propertyId, date, today, text }}
      label="Make a visit"
      className="min-h-tap"
      onCreated={() => router.refresh()}
    />
  )
}
