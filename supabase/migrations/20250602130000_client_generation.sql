-- Client-side generation: metadata-only editions, jobs created via Edge Function
ALTER TABLE public.generated_editions
  ALTER COLUMN image_path DROP NOT NULL,
  ALTER COLUMN metadata_path DROP NOT NULL;

ALTER TABLE public.generated_editions
  ADD COLUMN IF NOT EXISTS preview_thumb_path TEXT;

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS client_mode BOOLEAN NOT NULL DEFAULT true;

-- Jobs are inserted by verify-generation Edge Function (service role)
DROP POLICY IF EXISTS "Users can create jobs for own projects" ON public.generation_jobs;

CREATE POLICY "Users can update own jobs"
  ON public.generation_jobs FOR UPDATE
  USING (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));

CREATE POLICY "Users can delete own jobs"
  ON public.generation_jobs FOR DELETE
  USING (public.is_project_owner(project_id));

CREATE POLICY "Users can insert own editions"
  ON public.generated_editions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.generation_jobs gj
      WHERE gj.id = generated_editions.job_id
      AND public.is_project_owner(gj.project_id)
    )
  );

CREATE POLICY "Users can update own editions"
  ON public.generated_editions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.generation_jobs gj
      WHERE gj.id = generated_editions.job_id
      AND public.is_project_owner(gj.project_id)
    )
  );

CREATE POLICY "Users can delete own editions"
  ON public.generated_editions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.generation_jobs gj
      WHERE gj.id = generated_editions.job_id
      AND public.is_project_owner(gj.project_id)
    )
  );
