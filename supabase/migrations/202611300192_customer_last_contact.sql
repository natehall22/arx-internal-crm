-- "Last contact" for a customer (Customer File header + sortable Customers column), 2026-11-30. Derived from the contact logging that
-- already exists: activities of type call / text / email / visit on the customer (what `postMessage` writes for a logged contact, and
-- what the inside-sales / referral touch buttons write), newest per customer, with who did it. Nothing new is written anywhere.
-- Visibility: only contacts the viewer may read (arx_private.message_visible_to, the same evaluator as search_messages; rows with
-- no audience are readable as before), so a Production-only log never shows its date to someone who may not read it.
-- Additive: one function + one partial index. Service role only. Rollback: DROP FUNCTION public.customer_last_contact(uuid, uuid, uuid[]);
--   DROP INDEX activities_customer_contact_idx;
CREATE INDEX IF NOT EXISTS activities_customer_contact_idx
  ON public.activities (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL AND type IN ('call', 'text', 'email', 'visit');

CREATE OR REPLACE FUNCTION public.customer_last_contact(p_org uuid, p_viewer uuid, p_customer_ids uuid[])
RETURNS TABLE (customer_id uuid, at timestamptz, kind text, by_user_id uuid, by_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (a.customer_id) a.customer_id, a.created_at, a.type::text, a.user_id, u.full_name
  FROM activities a
  LEFT JOIN users u ON u.id = a.user_id AND u.org_id = p_org
  WHERE a.org_id = p_org
    AND a.customer_id = ANY (p_customer_ids)
    AND a.deleted_at IS NULL
    AND a.type IN ('call', 'text', 'email', 'visit')
    AND a.referral_partner_id IS NULL
    AND arx_private.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id)
  ORDER BY a.customer_id, a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.customer_last_contact(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_last_contact(uuid, uuid, uuid[]) TO service_role;
