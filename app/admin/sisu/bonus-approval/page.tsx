import { redirect } from 'next/navigation'

/** Moved: bonus approval is pay, so it lives under Money (app/admin/bonuses). Old links and bookmarks land there. */
export default function BonusApprovalMovedPage(): never {
  redirect('/admin/bonuses')
}
