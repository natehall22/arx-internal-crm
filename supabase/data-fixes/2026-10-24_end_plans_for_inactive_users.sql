-- End every open pay-plan assignment of an inactive user. Last covered day = the day BEFORE their first inactive day
-- (user_payroll_active_history, written by the deactivation trigger). Run AFTER migration 202610240040.
-- Assignments that start after the deactivation date are left alone and shown in the preview.

-- Generic backup table for data fixes (additive): the pre-state of every row a fix changes, so rollback is exact.
CREATE TABLE IF NOT EXISTS data_fix_backups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fix        TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_data   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE data_fix_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON data_fix_backups FROM anon, authenticated;

-- PREVIEW (read-only): inactive users with an open plan that have NO is_active=false history row (the fix can't date these — listed so none is skipped silently).
SELECT u.full_name, p.id AS assignment_id FROM user_comp_plans p JOIN users u ON u.id = p.user_id
WHERE u.active = FALSE AND (p.effective_to IS NULL OR p.effective_to > CURRENT_DATE)
  AND NOT EXISTS (SELECT 1 FROM user_payroll_active_history h WHERE h.user_id = u.id AND h.is_active = FALSE);

-- PREVIEW (read-only): count, plus any odd rows.
WITH last_off AS (
  SELECT DISTINCT ON (h.user_id) h.user_id, h.effective_from AS first_inactive_day
  FROM user_payroll_active_history h
  WHERE h.is_active = FALSE
  ORDER BY h.user_id, h.effective_from DESC
), todo AS (
  SELECT p.id, p.user_id, p.effective_from, p.effective_to, (l.first_inactive_day - 1) AS new_end
  FROM user_comp_plans p
  JOIN users u ON u.id = p.user_id AND u.active = FALSE
  JOIN last_off l ON l.user_id = p.user_id
  WHERE p.effective_to IS NULL OR p.effective_to > (l.first_inactive_day - 1)
)
SELECT count(*) FILTER (WHERE effective_from <= new_end) AS will_end,
       count(*) FILTER (WHERE effective_from >  new_end) AS start_after_departure_left_alone
FROM todo;

BEGIN;
INSERT INTO data_fix_backups (fix, table_name, row_data)
SELECT '2026-10-24_end_plans_for_inactive_users', 'user_comp_plans', to_jsonb(p)
  FROM user_comp_plans p
  JOIN users u ON u.id = p.user_id AND u.active = FALSE
  JOIN (SELECT DISTINCT ON (h.user_id) h.user_id, h.effective_from AS first_inactive_day FROM user_payroll_active_history h WHERE h.is_active = FALSE ORDER BY h.user_id, h.effective_from DESC) l ON l.user_id = p.user_id
 WHERE p.effective_from <= l.first_inactive_day - 1 AND (p.effective_to IS NULL OR p.effective_to > l.first_inactive_day - 1);
UPDATE user_comp_plans p
   SET effective_to = l.first_inactive_day - 1
  FROM users u,
       (SELECT DISTINCT ON (h.user_id) h.user_id, h.effective_from AS first_inactive_day
          FROM user_payroll_active_history h WHERE h.is_active = FALSE
         ORDER BY h.user_id, h.effective_from DESC) l
 WHERE u.id = p.user_id AND u.active = FALSE AND l.user_id = p.user_id
   AND p.effective_from <= l.first_inactive_day - 1
   AND (p.effective_to IS NULL OR p.effective_to > l.first_inactive_day - 1);
COMMIT;

-- Rollback (exact): UPDATE user_comp_plans p SET effective_to = (b.row_data->>'effective_to')::date
--   FROM data_fix_backups b WHERE b.fix = '2026-10-24_end_plans_for_inactive_users' AND b.table_name = 'user_comp_plans' AND p.id = (b.row_data->>'id')::uuid;
