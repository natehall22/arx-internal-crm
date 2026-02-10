-- Create storage bucket for proposals if it doesn't exist
-- Note: This needs to be run in Supabase Dashboard > Storage > Create Bucket
-- Or via Supabase CLI

-- Add pdf_url and pdf_generated_at columns to proposals if they don't exist
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;

-- Storage bucket policies (run in Supabase Dashboard > Storage > Policies)
-- Bucket name: proposals

-- Policy 1: Allow authenticated users to upload to their org's folder
-- CREATE POLICY "Users can upload proposal PDFs"
-- ON storage.objects FOR INSERT
-- WITH CHECK (
--   bucket_id = 'proposals' 
--   AND auth.role() = 'authenticated'
-- );

-- Policy 2: Allow authenticated users to read proposal PDFs
-- CREATE POLICY "Users can read proposal PDFs"
-- ON storage.objects FOR SELECT
-- USING (
--   bucket_id = 'proposals'
--   AND auth.role() = 'authenticated'
-- );

-- Policy 3: Allow authenticated users to update their PDFs
-- CREATE POLICY "Users can update proposal PDFs"
-- ON storage.objects FOR UPDATE
-- USING (
--   bucket_id = 'proposals'
--   AND auth.role() = 'authenticated'
-- );
