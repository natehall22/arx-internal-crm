import { redirect } from 'next/navigation'

/** Kept for bookmarks: both sheets are edited on one page now. */
export default function RunSheetRedirect({ params }: { params: { id: string } }) {
  redirect(`/ops/jobs/${params.id}/sheets`)
}
