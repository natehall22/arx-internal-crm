-- Structured rep -> inside-sales handoff context, captured when the closer records
-- an inspection outcome that routes to the inside-sales queue.
-- Shape (all keys optional):
-- {
--   "claim_filed": "yes" | "no" | "customer_filing",
--   "claim_number": "...",
--   "insurance_carrier": "...",
--   "adjuster_meeting_at": "2026-07-14T14:00:00Z",
--   "decision_maker": "...",
--   "best_call_window": "morning" | "afternoon" | "evening" | "anytime",
--   "context_line": "one-line 'what I told the customer'"
-- }
alter table public.opportunities
  add column if not exists handoff_context jsonb;
