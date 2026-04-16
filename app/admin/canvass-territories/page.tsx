import { redirect } from 'next/navigation'

/** Work areas are managed in the Canvass app (managers: /canvass/territories). */
export default function AdminCanvassTerritoriesRedirectPage() {
  redirect('/canvass/territories')
}
