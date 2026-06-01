import { supabase } from "./supabase";

/** 7 days — matches API gallery TTL; keeps repeat Traits visits off egress. */
export const TRAIT_SIGNED_TTL = 60 * 60 * 24 * 7;

export function traitThumbPath(storagePath) {
  const slash = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slash);
  const file = storagePath
    .slice(slash + 1)
    .replace(/\.(png|jpe?g|gif)$/i, ".webp");
  return `${dir}/thumbs/${file}`;
}

async function signStoragePath(path) {
  const { data, error } = await supabase.storage
    .from("layer-assets")
    .createSignedUrl(path, TRAIT_SIGNED_TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Prefer WebP thumb; caller should fall back to full PNG on img error if thumb 404s. */
export async function signTraitThumbUrl(storagePath) {
  if (!storagePath) return null;
  return signStoragePath(traitThumbPath(storagePath));
}

export async function signTraitFullUrl(storagePath) {
  if (!storagePath) return null;
  return signStoragePath(storagePath);
}

/**
 * Sign preview URLs for a layer's traits directly via the user's Supabase session
 * (same RLS as uploads). Batches to avoid flooding the client.
 */
export async function loadLayerPreviewUrls(traits, { batchSize = 25, onProgress } = {}) {
  const urls = {};
  for (let i = 0; i < traits.length; i += batchSize) {
    const slice = traits.slice(i, i + batchSize);
    await Promise.all(
      slice.map(async (trait) => {
        if (!trait.storage_path) {
          urls[trait.id] = null;
          return;
        }
        const thumb = await signTraitThumbUrl(trait.storage_path);
        urls[trait.id] = thumb || (await signTraitFullUrl(trait.storage_path));
      })
    );
    onProgress?.({ ...urls }, Math.min(i + batchSize, traits.length), traits.length);
  }
  return urls;
}
