import { supabase } from "./supabase";

export function traitThumbPath(storagePath) {
  const slash = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slash);
  const file = storagePath
    .slice(slash + 1)
    .replace(/\.(png|jpe?g|gif)$/i, ".webp");
  return `${dir}/thumbs/${file}`;
}

/**
 * Download a trait preview via the user's Supabase session (RLS).
 * Tries the small WebP thumb first, then the full PNG.
 */
export async function fetchTraitPreviewBlobUrl(storagePath) {
  if (!storagePath) return null;

  for (const path of [traitThumbPath(storagePath), storagePath]) {
    const { data, error } = await supabase.storage.from("layer-assets").download(path);
    if (!error && data) {
      const blob = data instanceof Blob ? data : await data.blob();
      return URL.createObjectURL(blob);
    }
  }
  return null;
}

export function revokeBlobUrl(url) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}
