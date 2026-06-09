-- Raise badge image upload limit from 2 MB to 10 MB
UPDATE storage.buckets
SET file_size_limit = 10485760 -- 10 MB
WHERE id = 'badge-images';
