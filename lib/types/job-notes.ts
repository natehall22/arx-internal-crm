/** Job note row for UI lists with optional author from a `users` join */
export type JobNoteWithAuthor = {
  id: string
  note: string
  is_internal: boolean
  created_at: string
  user?: { full_name?: string | null } | null
}
