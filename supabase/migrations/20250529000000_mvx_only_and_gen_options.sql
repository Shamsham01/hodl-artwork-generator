-- MultiversX-only + full generation options
-- 1. Make the platform MultiversX-only (remove eth/sol)
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_network_check;

UPDATE public.projects SET network = 'mvx' WHERE network IN ('eth', 'sol');

ALTER TABLE public.projects ALTER COLUMN network SET DEFAULT 'mvx';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_network_check CHECK (network IN ('mvx'));

-- 2. Store all engine generation options (image size lives in canvas_width/height
--    already; this holds the remaining HashLips config options).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS gen_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Track the packaged (png + json in one folder) download artifact per job.
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS bundle_path TEXT;

-- 4. Allow zip downloads to be read by owners from the generations bucket
--    (mime type already includes application/zip).
