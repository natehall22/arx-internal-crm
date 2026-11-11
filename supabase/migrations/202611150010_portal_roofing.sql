-- Customer portal for job-based (roofing) customers. Additive / nullable only. NOT applied by the builder.
-- Apply AFTER 202611120060_customer_portal.sql. The portal code reads these columns softly (a missing column shows
-- nothing extra; it never breaks the page), and the staff switches below say "turns on once the update is applied".
--
-- 1. customers.portal_invited_at: staff tapped "Invite to portal". In an invite-only company (roofing default) only
--    invited customers can get a sign-in link or keep a session. NULL = not invited.
-- 2. photos.shared_with_customer: staff marked this one job photo "Show to customer". Default false.
-- 3. production_jobs.portal_show_crew_photos: one tap per job, "Show crew photos to customer" - the crew's four
--    walk-around shots (front / back / left / right) on that job's trades. Default false.
--
-- Down (manual): alter table public.customers drop column portal_invited_at;
--   alter table public.photos drop column shared_with_customer;
--   alter table public.production_jobs drop column portal_show_crew_photos;

begin;
set local lock_timeout = '5s';

alter table public.customers add column if not exists portal_invited_at timestamptz null;
alter table public.photos add column if not exists shared_with_customer boolean not null default false;
alter table public.production_jobs add column if not exists portal_show_crew_photos boolean not null default false;

commit;
