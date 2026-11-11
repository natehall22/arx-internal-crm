-- AI connector hardening. NOT applied. Additive only: two small tables + three functions, nothing existing is changed.
-- Service-role only (RLS on, no policies, no grants), like the rest of the connector tables.

-- Rate counters that hold across server instances. One row per (key, time window).
CREATE TABLE IF NOT EXISTS public.ai_rate_hits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS ai_rate_hits_window_idx ON public.ai_rate_hits (window_start);

-- "Do this once" claims (a consent approval may mint one code, ever).
CREATE TABLE IF NOT EXISTS public.ai_once_keys (
  key        text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.ai_rate_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_once_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_rate_hits, public.ai_once_keys FROM anon, authenticated;

-- Count one hit; allowed while the window's count is within the limit. Returns (allowed, retry_after_seconds).
CREATE OR REPLACE FUNCTION public.ai_rate_hit(p_key text, p_window_seconds integer, p_limit integer)
RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  n integer;
BEGIN
  INSERT INTO public.ai_rate_hits AS r (key, window_start, hits) VALUES (p_key, w, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO n;
  IF random() < 0.02 THEN
    DELETE FROM public.ai_rate_hits WHERE window_start < now() - interval '2 days';
    DELETE FROM public.ai_once_keys WHERE expires_at < now();
  END IF;
  allowed := n <= p_limit;
  retry_after := GREATEST(1, ceil(extract(epoch FROM (w + make_interval(secs => p_window_seconds) - now())))::integer);
  RETURN NEXT;
END $$;

-- True for the FIRST caller of a key (until it expires); false for everyone after.
CREATE OR REPLACE FUNCTION public.ai_claim_once(p_key text, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE got text;
BEGIN
  INSERT INTO public.ai_once_keys AS o (key, expires_at) VALUES (p_key, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (key) DO UPDATE SET expires_at = excluded.expires_at WHERE o.expires_at < now()
  RETURNING o.key INTO got;
  RETURN got IS NOT NULL;
END $$;

-- Apps that registered but were never used for a sign-in: delete after p_days. Apps with any grant stay.
CREATE OR REPLACE FUNCTION public.ai_prune_unused_clients(p_days integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.ai_oauth_clients c
  WHERE c.kind = 'dcr' AND c.created_at < now() - make_interval(days => p_days)
    AND NOT EXISTS (SELECT 1 FROM public.ai_oauth_grants g WHERE g.client_id = c.client_id)
    AND NOT EXISTS (SELECT 1 FROM public.ai_oauth_codes k WHERE k.client_id = c.client_id AND k.expires_at > now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.ai_rate_hit(text, integer, integer), public.ai_claim_once(text, integer), public.ai_prune_unused_clients(integer) FROM public, anon, authenticated;
