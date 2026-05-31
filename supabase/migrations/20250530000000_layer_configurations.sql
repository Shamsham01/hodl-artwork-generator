-- Multiple layer configurations per project ("characters").
-- Each configuration defines its own edition count and ordered subset of layers,
-- mirroring HashLips' layerConfigurations array in src/config.js.
CREATE TABLE IF NOT EXISTS public.layer_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  label TEXT,
  edition_count INT NOT NULL DEFAULT 100,
  -- Ordered array of { "name": "LAYER" } objects (back -> front draw order).
  layers_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_configurations_project
  ON public.layer_configurations(project_id);

ALTER TABLE public.layer_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own layer configurations"
  ON public.layer_configurations FOR ALL
  USING (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));
