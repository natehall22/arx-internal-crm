import { redirect } from 'next/navigation'

/** Work areas are managed in the Canvass app (managers: /canvass?areas=1). */
export default function AdminCanvassTerritoriesRedirectPage() {
  redirect('/canvass?areas=1')
}
