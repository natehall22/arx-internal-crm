import { redirect } from 'next/navigation'

/** Kept for bookmarks: the old HTML print page is gone; both sheets are edited on one page now. */
export default function MaterialOrderPrintRedirect({ params }: { params: { id: string } }) {
  redirect(`/ops/jobs/${params.id}/sheets`)
}
