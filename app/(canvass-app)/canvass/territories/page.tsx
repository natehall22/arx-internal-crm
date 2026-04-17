import { redirect } from 'next/navigation'

/** Legacy URL — work areas live in the main canvass shell (`/canvass?areas=1`). */
export default function CanvassTerritoriesLegacyRedirect() {
  redirect('/canvass?areas=1')
}
