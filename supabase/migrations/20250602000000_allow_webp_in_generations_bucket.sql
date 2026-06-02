-- The generations bucket originally allowed only PNG/JSON/ZIP, so the WebP
-- gallery thumbnails uploaded during generation were silently rejected
-- (Storage.upload() returns an error object instead of throwing). That left
-- the Generate page live preview showing empty grey tiles. Allow image/webp
-- so edition thumbnails can be stored, matching the layer-assets bucket.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/webp', 'application/json', 'application/zip']
WHERE id = 'generations';
