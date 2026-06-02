import { downloadLayerAsset, traitThumbPath } from "./storageDownload";

export { traitThumbPath };

/**
 * Download a trait preview via the user's Supabase session (RLS).
 * Tries the small WebP thumb first, then the full PNG as a fallback.
 */
export async function fetchTraitPreviewBlobUrl(storagePath) {
  if (!storagePath) return null;

  const blob = await downloadLayerAsset(storagePath, { preferThumb: true });
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export function revokeBlobUrl(url) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}
