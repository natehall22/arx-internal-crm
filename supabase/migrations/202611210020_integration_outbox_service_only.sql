-- HARDENING (apply after the QuickBooks worker code ships). NOT APPLIED — file only.
--
-- 055_integration_ready.sql left integration_outbox with a policy "Service role can manage outbox ... FOR ALL USING (true)". With
-- no `TO service_role` that policy applies to EVERY role, so any signed-in browser user could insert, rewrite or delete outbox
-- rows through the public API — and from the QuickBooks worker's PR on, an outbox row can cause a posting into a company's books.
-- The service role bypasses row-level security anyway, so neither policy is needed: nothing in the app reads the outbox
-- with a user session (only lib/integrations.ts and the worker, both service role).
--
-- This is the one non-additive statement in the QuickBooks work, on purpose. Down (manual): re-create the two policies from 055.
begin;
set local lock_timeout = '5s';

drop policy if exists "Service role can manage outbox" on public.integration_outbox;
drop policy if exists "Users can read outbox events for their org" on public.integration_outbox;
revoke all on table public.integration_outbox from anon, authenticated;

commit;
