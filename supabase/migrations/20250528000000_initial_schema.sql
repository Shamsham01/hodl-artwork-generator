-- Basturds NFT Generator Schema
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles linked to auth.users (wallet-based)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects (NFT collections)
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  name_prefix TEXT DEFAULT 'Collection',
  base_uri TEXT DEFAULT 'ipfs://NewUriToReplace',
  network TEXT NOT NULL DEFAULT 'eth' CHECK (network IN ('eth', 'sol')),
  edition_size INT NOT NULL DEFAULT 1000,
  canvas_width INT NOT NULL DEFAULT 512,
  canvas_height INT NOT NULL DEFAULT 512,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'generating', 'complete', 'failed')),
  solana_metadata JSONB DEFAULT '{}',
  extra_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Layer order and options per project
CREATE TABLE public.project_layers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  options JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, name)
);

-- Traits parsed from uploaded PNGs
CREATE TABLE public.traits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layer_id UUID NOT NULL REFERENCES public.project_layers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight INT NOT NULL DEFAULT 1,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(layer_id, name)
);

-- Layer restrictions (trait compatibility rules)
CREATE TABLE public.layer_restrictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  trigger_layer TEXT NOT NULL,
  trigger_element TEXT NOT NULL,
  restriction_type TEXT NOT NULL CHECK (restriction_type IN ('exclude_layers', 'exclude_elements')),
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generation jobs
CREATE TABLE public.generation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  edition_size INT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  error_message TEXT,
  output_prefix TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generated edition metadata index
CREATE TABLE public.generated_editions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
  edition_number INT NOT NULL,
  dna TEXT NOT NULL,
  image_path TEXT NOT NULL,
  metadata_path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, edition_number)
);

-- Indexes
CREATE INDEX idx_projects_owner ON public.projects(owner_id);
CREATE INDEX idx_project_layers_project ON public.project_layers(project_id);
CREATE INDEX idx_traits_layer ON public.traits(layer_id);
CREATE INDEX idx_layer_restrictions_project ON public.layer_restrictions(project_id);
CREATE INDEX idx_generation_jobs_project ON public.generation_jobs(project_id);
CREATE INDEX idx_generation_jobs_status ON public.generation_jobs(status);
CREATE INDEX idx_generated_editions_job ON public.generated_editions(job_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layer_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_editions ENABLE ROW LEVEL SECURITY;

-- Helper: check project ownership
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Projects policies
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (owner_id = auth.uid());

-- Project layers policies
CREATE POLICY "Users can manage own project layers"
  ON public.project_layers FOR ALL
  USING (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));

-- Traits policies
CREATE POLICY "Users can manage own traits"
  ON public.traits FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_layers pl
      WHERE pl.id = traits.layer_id
      AND public.is_project_owner(pl.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_layers pl
      WHERE pl.id = traits.layer_id
      AND public.is_project_owner(pl.project_id)
    )
  );

-- Layer restrictions policies
CREATE POLICY "Users can manage own restrictions"
  ON public.layer_restrictions FOR ALL
  USING (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));

-- Generation jobs policies
CREATE POLICY "Users can view own jobs"
  ON public.generation_jobs FOR SELECT
  USING (public.is_project_owner(project_id));

CREATE POLICY "Users can create jobs for own projects"
  ON public.generation_jobs FOR INSERT
  WITH CHECK (public.is_project_owner(project_id));

-- Generated editions policies
CREATE POLICY "Users can view own editions"
  ON public.generated_editions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.generation_jobs gj
      WHERE gj.id = generated_editions.job_id
      AND public.is_project_owner(gj.project_id)
    )
  );

-- Storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('layer-assets', 'layer-assets', false, 52428800, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  ('generations', 'generations', false, 104857600, ARRAY['image/png', 'application/json', 'application/zip'])
ON CONFLICT (id) DO NOTHING;

-- Storage path convention: {owner_id}/{project_id}/layers/{LAYER}/{file}
-- or {owner_id}/{project_id}/jobs/{job_id}/...

CREATE OR REPLACE FUNCTION public.storage_owner_matches(object_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT auth.uid()::text = (storage.foldername(object_name))[1];
$$ LANGUAGE sql STABLE;

-- Storage policies for layer-assets
CREATE POLICY "Users can upload layer assets to own projects"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'layer-assets'
    AND public.storage_owner_matches(name)
  );

CREATE POLICY "Users can read own layer assets"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'layer-assets'
    AND public.storage_owner_matches(name)
  );

CREATE POLICY "Users can update own layer assets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'layer-assets'
    AND public.storage_owner_matches(name)
  );

CREATE POLICY "Users can delete own layer assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'layer-assets'
    AND public.storage_owner_matches(name)
  );

-- Storage policies for generations
CREATE POLICY "Users can read own generations"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'generations'
    AND public.storage_owner_matches(name)
  );

-- Service role handles generation writes via API (bypasses RLS with service key)

-- Enable realtime for job progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.generation_jobs;
