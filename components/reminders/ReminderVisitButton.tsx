'use client'

import { useRouter } from 'next/navigation'

import OneOffVisit from '@/components/service-plans/OneOffVisit'

/** "Make a visit" on a reminder row: the existing one-off visit sheet, filled in from the reminder; saving also finishes the reminder. */
export function ReminderVisitButton({ reminderId, customerId, propertyId, date, notes }: { reminderId: string; customerId: string; propertyId: string | null; date: string; notes: string }) {
  const router = useRouter()
  return (
    <OneOffVisit
      prefill={{ reminderId, customerId, propertyId, date, notes }}
      label="Make a visit"
      className="min-h-tap"
      onCreated={() => router.refresh()}
    />
  )
}
