/**
 * The one HTML-escape for strings put into email/HTML bodies. Many older files still carry a local copy
 * (CLAUDE.md Known Redundancy) — migrate a file onto this when you touch it; do not add another copy.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
