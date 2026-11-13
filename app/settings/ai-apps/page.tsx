import { redirect } from 'next/navigation'

// One place for a person's AI apps: Settings → Connect your AI (address + connected apps). This old address goes there.
export default function AiAppsPage() {
  redirect('/settings?tab=connect')
}
