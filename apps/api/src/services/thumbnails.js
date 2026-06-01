const { createThumbnail } = require("@basturds/engine");
const { supabase } = require("../lib/supabase");

const TRAIT_THUMB_SIZE = 128;

/** layer-assets path for a small WebP preview (same pattern as generation thumbs). */
function traitThumbPath(storagePath) {
  const slash = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slash);
  const file = storagePath
    .slice(slash + 1)
    .replace(/\.(png|jpe?g|gif)$/i, ".webp");
  return `${dir}/thumbs/${file}`;
}

async function traitThumbExists(thumbPath) {
  const slash = thumbPath.lastIndexOf("/");
  const dir = thumbPath.slice(0, slash);
  const name = thumbPath.slice(slash + 1);
  const { data, error } = await supabase.storage.from("layer-assets").list(dir);
  if (error || !data) return false;
  return data.some((f) => f.name === name);
}

/**
 * Create and upload a WebP thumb for one layer trait if it does not exist yet.
 * The full PNG is downloaded once; all future Traits-page views use the thumb.
 */
async function ensureTraitThumb(storagePath) {
  const thumbPath = traitThumbPath(storagePath);
  if (await traitThumbExists(thumbPath)) return thumbPath;

  const { data, error } = await supabase.storage
    .from("layer-assets")
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download ${storagePath}: ${error?.message || "missing"}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const thumb = await createThumbnail(buffer, TRAIT_THUMB_SIZE);
  await supabase.storage
    .from("layer-assets")
    .upload(thumbPath, thumb, { contentType: "image/webp", upsert: true });

  return thumbPath;
}

async function ensureTraitThumbs(storagePaths) {
  const created = [];
  for (const storagePath of storagePaths) {
    try {
      await ensureTraitThumb(storagePath);
      created.push(storagePath);
    } catch (err) {
      console.error(`Trait thumb failed for ${storagePath}:`, err.message);
    }
  }
  return created.length;
}

module.exports = {
  traitThumbPath,
  ensureTraitThumb,
  ensureTraitThumbs,
  TRAIT_THUMB_SIZE,
};
