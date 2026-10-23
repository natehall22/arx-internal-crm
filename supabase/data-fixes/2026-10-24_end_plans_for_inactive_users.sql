-- End every open pay-plan assignment of an inactive user. Last covered day = the day BEFORE their first inactive day
-- (user_payroll_active_history, written by the deactivation trigger). Run AFTER migration 202610240040.
-- Assignments that start after the deactivation date are left alone and shown in the preview.

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

-- Rollback: there is no automatic undo (the old effective_to values were NULL or later dates). Re-open a plan from
-- the Comp Plans page if a person is reinstated.
