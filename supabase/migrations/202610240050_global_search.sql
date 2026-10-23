-- Global search (Cmd/Ctrl-K): typo-tolerant across customers, jobs, proposals and opportunities with pg_trgm.
-- Additive: indexes + one function. Callable by the service role only; the API route decides WHICH kinds a person may
-- search and passes p_owner for rep-scoped roles (they only find their own records, same as their list pages).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_search_customers_name  ON customers USING gin (lower(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_customers_addr  ON customers USING gin (lower(address_text) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_jobs_number     ON production_jobs USING gin (lower(job_number) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_jobs_addr       ON production_jobs USING gin (lower(address_text) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_proposals_name  ON proposals USING gin (lower(customer_name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_opps_addr       ON opportunities USING gin (lower(address_text) extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_all(
  p_org   uuid,
  p_q     text,
  p_kinds text[],
  p_owner uuid DEFAULT NULL,   -- non-null: only records this user owns (rep-scoped roles)
  p_limit int  DEFAULT 20
)
RETURNS TABLE (kind text, id uuid, title text, subtitle text, score real)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT lower(btrim(p_q)) AS t,
           regexp_replace(p_q, '\D', '', 'g') AS digits,
           '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  ),
  hits AS (
    -- customers
    SELECT 'customer'::text AS kind, c.id, c.name AS title,
           concat_ws(' · ', c.address_text, c.phone) AS subtitle,
           greatest(similarity(lower(c.name), q.t), word_similarity(q.t, lower(coalesce(c.address_text, ''))),
                    CASE WHEN length(q.digits) >= 4 AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%' THEN 1 ELSE 0 END,
                    CASE WHEN lower(coalesce(c.email, '')) LIKE q.pat THEN 0.9 ELSE 0 END) AS score
    FROM customers c, q
    WHERE 'customer' = ANY (p_kinds) AND c.org_id = p_org
      AND (p_owner IS NULL OR c.id IN (SELECT pr.customer_id FROM projects pr WHERE pr.org_id = p_org AND pr.owner_user_id = p_owner AND pr.customer_id IS NOT NULL))
      AND (lower(c.name) LIKE q.pat OR lower(coalesce(c.address_text, '')) LIKE q.pat OR lower(coalesce(c.email, '')) LIKE q.pat
           OR (length(q.digits) >= 4 AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%')
           OR (length(q.t) >= 3 AND word_similarity(q.t, lower(c.name)) >= 0.4) OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(c.address_text, ''))) >= 0.4))
    UNION ALL
    -- jobs
    SELECT 'job', j.id, 'Job ' || j.job_number, concat_ws(' · ', j.address_text, j.status),
           greatest(similarity(lower(j.job_number), q.t), word_similarity(q.t, lower(coalesce(j.address_text, ''))),
                    CASE WHEN lower(j.job_number) LIKE q.pat THEN 0.95 ELSE 0 END)
    FROM production_jobs j, q
    WHERE 'job' = ANY (p_kinds) AND j.org_id = p_org AND j.status <> 'cancelled'
      AND (p_owner IS NULL OR j.salesperson_id = p_owner)
      AND (lower(j.job_number) LIKE q.pat OR lower(coalesce(j.address_text, '')) LIKE q.pat OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(j.address_text, ''))) >= 0.4))
    UNION ALL
    -- proposals
    SELECT 'proposal', p.id, coalesce(p.customer_name, 'Proposal') || coalesce(' · #' || p.proposal_number::text, ''), concat_ws(' · ', p.customer_phone, p.status),
           greatest(similarity(lower(coalesce(p.customer_name, '')), q.t),
                    CASE WHEN lower(coalesce(p.proposal_number::text, '')) LIKE q.pat THEN 0.95 ELSE 0 END,
                    CASE WHEN length(q.digits) >= 4 AND regexp_replace(coalesce(p.customer_phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%' THEN 1 ELSE 0 END)
    FROM proposals p, q
    WHERE 'proposal' = ANY (p_kinds) AND p.org_id = p_org
      AND (p_owner IS NULL OR p.created_by = p_owner)
      AND (lower(coalesce(p.customer_name, '')) LIKE q.pat OR lower(coalesce(p.proposal_number::text, '')) LIKE q.pat
           OR (length(q.digits) >= 4 AND regexp_replace(coalesce(p.customer_phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%')
           OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(p.customer_name, ''))) >= 0.4))
    UNION ALL
    -- opportunities (by address)
    SELECT 'opportunity', o.id, coalesce(o.address_text, 'Opportunity'), o.status::text,
           word_similarity(q.t, lower(coalesce(o.address_text, '')))
    FROM opportunities o, q
    WHERE 'opportunity' = ANY (p_kinds) AND o.org_id = p_org
      AND (p_owner IS NULL OR o.owner_user_id = p_owner OR o.setter_user_id = p_owner)
      AND (lower(coalesce(o.address_text, '')) LIKE q.pat OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(o.address_text, ''))) >= 0.4))
  )
  SELECT kind, id, title, subtitle, score::real FROM hits ORDER BY score DESC, title LIMIT greatest(1, least(p_limit, 50));
$$;

REVOKE ALL ON FUNCTION search_all(uuid, text, text[], uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_all(uuid, text, text[], uuid, int) TO service_role;
-- Rollback: DROP FUNCTION search_all(uuid, text, text[], uuid, int); DROP INDEX idx_search_customers_name, idx_search_customers_addr, idx_search_jobs_number, idx_search_jobs_addr, idx_search_proposals_name, idx_search_opps_addr;
