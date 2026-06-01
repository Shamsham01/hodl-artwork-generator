const { createThumbnail } = require("@basturds/engine");
const { supabase } = require("../lib/supabase");

const TRAIT_THUMB_SIZE = 128;
const LIST_PAGE = 100;

/** layer-assets path for a small WebP preview (same pattern as generation thumbs). */
function traitThumbPath(storagePath) {
  const slash = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slash);
  const file = storagePath
    .slice(slash + 1)
    .replace(/\.(png|jpe?g|gif)$/i, ".webp");
  return `${dir}/thumbs/${file}`;
}

function thumbFileName(storagePath) {
  return traitThumbPath(storagePath).slice(traitThumbPath(storagePath).lastIndexOf("/") + 1);
}

/** Paginated list — Supabase returns at most 100 objects per list() call. */
async function listFilesInDir(dir) {
  const names = new Set();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from("layer-assets")
      .list(dir, { limit: LIST_PAGE, offset });
    if (error || !data?.length) break;
    for (const f of data) names.add(f.name);
    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return names;
}

async function traitThumbExists(thumbPath) {
  const slash = thumbPath.lastIndexOf("/");
  const dir = thumbPath.slice(0, slash);
  const name = thumbPath.slice(slash + 1);
  const { data, error } = await supabase.storage.from("layer-assets").list(dir, {
    limit: 1,
    search: name.replace(/\.webp$/i, ""),
  });
  if (error || !data) return false;
  return data.some((f) => f.name === name);
}

/**
 * Create and upload a WebP thumb for one layer trait if it does not exist yet.
 * The full PNG is downloaded once; all future Traits-page views use the thumb.
 */
async function ensureTraitThumb(storagePath, existingNames = null) {
  const thumbPath = traitThumbPath(storagePath);
  const fileName = thumbFileName(storagePath);
  if (existingNames ? existingNames.has(fileName) : await traitThumbExists(thumbPath)) {
    return thumbPath;
  }

  const { data, error } = await supabase.storage
    .from("layer-assets")
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download ${storagePath}: ${error?.message || "missing"}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const thumb = await createThumbnail(buffer, TRAIT_THUMB_SIZE);
  const { error: uploadError } = await supabase.storage
    .from("layer-assets")
    .upload(thumbPath, thumb, { contentType: "image/webp", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload ${thumbPath}: ${uploadError.message}`);
  }

  existingNames?.add(fileName);
  return thumbPath;
}

async function runPool(items, concurrency, fn) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
}

async function ensureTraitThumbs(storagePaths, { concurrency = 4, existingNames = null } = {}) {
  let created = 0;
  await runPool(storagePaths, concurrency, async (storagePath) => {
    try {
      await ensureTraitThumb(storagePath, existingNames);
      created++;
    } catch (err) {
      console.error(`Trait thumb failed for ${storagePath}:`, err.message);
    }
  });
  return created;
}

/** List every WebP already stored under {layerDir}/thumbs. */
async function listLayerThumbNames(layerStorageDir) {
  return listFilesInDir(`${layerStorageDir}/thumbs`);
}

module.exports = {
  traitThumbPath,
  thumbFileName,
  ensureTraitThumb,
  ensureTraitThumbs,
  listLayerThumbNames,
  TRAIT_THUMB_SIZE,
};
