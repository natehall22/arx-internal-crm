-- Cap single objects in the `files` storage bucket at 50 MB (52,428,800 bytes), matching CUSTOMER_FILE_MAX_BYTES in
-- lib/customer-file/customer-files.ts. Today the bucket has no limit, so a signed upload URL accepts any size and the app can
-- only delete an oversize object after it landed (customer files finalize does that). With this, storage refuses it up front.
--
-- Safe to apply any time, before or after the code: checked 2026-11-09, the largest object in `files` is ~4.4 MB (0 over
-- 50 MB). Existing objects are not touched; the limit applies to new uploads only. Applies to every writer of this bucket
-- (contracts, change orders, proposal images, logo, job packets, customer files) — all far below 50 MB.
--
-- NOT APPLIED by the PR that adds it. Rollback: UPDATE storage.buckets SET file_size_limit = NULL WHERE id = 'files';

UPDATE storage.buckets
SET file_size_limit = 52428800
WHERE id = 'files';
