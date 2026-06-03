-- Allow "include_elements" restriction type (whitelist traits when trigger matches)
ALTER TABLE public.layer_restrictions
  DROP CONSTRAINT IF EXISTS layer_restrictions_restriction_type_check;

ALTER TABLE public.layer_restrictions
  ADD CONSTRAINT layer_restrictions_restriction_type_check
  CHECK (restriction_type IN ('exclude_layers', 'exclude_elements', 'include_elements'));
