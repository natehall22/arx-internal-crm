-- Internal job notes are readable only by people who can open the job page (2026-10-21).
--
-- Before: "Users can view job notes in their org" let ANY org user SELECT every job's
-- notes through the REST API with their own session token, and "Users can add job
-- notes" let any signed-in user insert a note on ANY job (no org or job check).
-- The app's API route already enforces the job-board rule (canReadJobNotes); this
-- brings the database in line.
--
-- can_view_job_board(uid) mirrors lib/effective-permissions.ts +
-- canAccessJobBoardFromPermissionNames (lib/permissions.ts) EXACTLY:
--   * role admin/owner                                   -> yes (superuser)
--   * custom_role_id set   -> that role's role_permissions   } plus user_permissions
--   * no custom role       -> the code's legacy role matrix  }  (no expiry check, same as TS)
--   * any of admin:full / jobs:view / jobs:edit           -> yes
-- Legacy roles whose code matrix includes jobs:view/jobs:edit/admin:full are listed in
-- JOB_BOARD_LEGACY_ROLES below; lib/__tests__/job-notes-rls-parity.test.ts recomputes
-- that list from the TS matrix for every users.role value and fails if they drift.
--
-- Unchanged: "Subs can view shared notes" (share_with_sub rows for the assigned sub).
-- Service-role readers (job run sheet, notes API, packets via service) bypass RLS.
-- Every app writer of production_job_notes uses the service role, so the tighter
-- INSERT rule breaks nothing. No UPDATE/DELETE policies exist (still denied).

BEGIN;

CREATE OR REPLACE FUNCTION public.can_view_job_board(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH u AS (
    SELECT lower(trim(role::text)) AS role, custom_role_id
    FROM public.users
    WHERE id = p_user
  ),
  names AS (
    SELECT p.name
    FROM u
    JOIN public.role_permissions rp ON rp.role_id = u.custom_role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    UNION ALL
    SELECT p.name
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = p_user
  )
  SELECT EXISTS (SELECT 1 FROM u)
    AND (
      EXISTS (SELECT 1 FROM u WHERE u.role IN ('admin', 'owner'))
      OR EXISTS (
        SELECT 1 FROM u
        WHERE u.custom_role_id IS NULL
          AND u.role = ANY (ARRAY['operations']::text[]) -- JOB_BOARD_LEGACY_ROLES
      )
      OR EXISTS (SELECT 1 FROM names WHERE name IN ('admin:full', 'jobs:view', 'jobs:edit'))
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_job_board(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_job_board(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_job_board(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view job notes in their org" ON public.production_job_notes;
DROP POLICY IF EXISTS production_job_notes_job_board_select ON public.production_job_notes;
CREATE POLICY production_job_notes_job_board_select ON public.production_job_notes
  FOR SELECT TO authenticated
  USING (
    public.can_view_job_board((SELECT auth.uid()))
    AND job_id IN (
      SELECT pj.id FROM public.production_jobs pj
      WHERE pj.org_id = public.get_user_org_id((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can add job notes" ON public.production_job_notes;
DROP POLICY IF EXISTS production_job_notes_job_board_insert ON public.production_job_notes;
CREATE POLICY production_job_notes_job_board_insert ON public.production_job_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_view_job_board((SELECT auth.uid()))
    AND job_id IN (
      SELECT pj.id FROM public.production_jobs pj
      WHERE pj.org_id = public.get_user_org_id((SELECT auth.uid()))
    )
  );

COMMIT;

-- Verify after applying:
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'production_job_notes';
--   -- expect: production_job_notes_job_board_select, production_job_notes_job_board_insert,
--   --         "Subs can view shared notes"
--   SELECT u.role, (u.custom_role_id IS NOT NULL) AS custom, public.can_view_job_board(u.id), count(*)
--     FROM users u GROUP BY 1, 2, 3 ORDER BY 1;
--
-- Rollback:
--   BEGIN;
--   DROP POLICY IF EXISTS production_job_notes_job_board_select ON public.production_job_notes;
--   DROP POLICY IF EXISTS production_job_notes_job_board_insert ON public.production_job_notes;
--   CREATE POLICY "Users can view job notes in their org" ON public.production_job_notes
--     FOR SELECT USING (job_id IN (SELECT production_jobs.id FROM production_jobs
--       WHERE production_jobs.org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid())));
--   CREATE POLICY "Users can add job notes" ON public.production_job_notes
--     FOR INSERT WITH CHECK (user_id = auth.uid());
--   DROP FUNCTION IF EXISTS public.can_view_job_board(uuid);
--   COMMIT;
