-- Notifications are private to their recipient (Phase 0 security, 2026-10-21).
--
-- Before: SELECT was allowed for ANY user in the org
--   ("Users can read notifications": org_id = get_user_org_id(auth.uid())),
-- so anyone holding their own session token could read every teammate's
-- notifications through the REST API, including note text in `body`.
-- UPDATE was already recipient-only but had no explicit WITH CHECK.
--
-- After: SELECT and UPDATE are recipient-only. INSERT is unchanged (org-scoped):
-- app routes and triggers create notifications FOR other people. No DELETE policy
-- exists or is added (deletes stay denied for API callers).
--
-- App impact: every app reader already filters `recipient_user_id = <caller>`
-- (/api/notifications, /api/notifications/stream, /api/setter/*), and no code path
-- does insert(...).select() on notifications, so nothing in the app changes.
-- Service-role callers bypass RLS; they must keep filtering by recipient themselves
-- (locked by lib/__tests__/notifications-recipient-only.test.ts).

BEGIN;

DROP POLICY IF EXISTS "Users can read notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_recipient_select ON public.notifications;
CREATE POLICY notifications_recipient_select ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;
CREATE POLICY notifications_recipient_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()))
  WITH CHECK (recipient_user_id = (SELECT auth.uid()));

COMMIT;

-- Verify after applying (expect exactly 3 rows: INSERT org-scoped, SELECT + UPDATE recipient-only):
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = 'notifications';
--
-- Rollback (restores the previous org-wide read):
--   BEGIN;
--   DROP POLICY IF EXISTS notifications_recipient_select ON public.notifications;
--   DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;
--   CREATE POLICY "Users can read notifications" ON public.notifications
--     FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
--   CREATE POLICY "Users can update own notifications" ON public.notifications
--     FOR UPDATE USING (recipient_user_id = auth.uid());
--   COMMIT;
