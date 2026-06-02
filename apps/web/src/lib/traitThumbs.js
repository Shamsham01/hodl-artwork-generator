/**
 * Trait preview WebPs in Storage (layer-assets/.../thumbs/*.webp).
 * Sized for 512×512 studio preview — targets ~25–50 KB to cut egress vs full PNGs.
 */

import { supabase } from "./supabase";
import { traitThumbPath } from "./storageDownload.js";

/** Match default engine preview/output canvas */
export const TRAIT_THUMB_MAX_PX = 512;

export const TRAIT_THUMB_TARGET_MIN_BYTES = 20_000;
export const TRAIT_THUMB_TARGET_MAX_BYTES = 55_000;

const QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76];

async function encodeWebpFromBlob(sourceBlob, maxPx, quality) {
  const bitmap = await createImageBitmap(sourceBlob);
  const ratio = Math.min(maxPx / bitmap.width, maxPx / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("WebP encode failed"))),
      "image/webp",
      quality
    );
  });
}

/**
 * Build a WebP thumb targeting ~25–50 KB at up to 512px (studio preview quality).
 */
export async function createTraitWebpThumb(sourceBlob) {
  let best = null;

  for (const quality of QUALITY_STEPS) {
    const blob = await encodeWebpFromBlob(
      sourceBlob,
      TRAIT_THUMB_MAX_PX,
      quality
    );
    if (blob.size >= TRAIT_THUMB_TARGET_MIN_BYTES &&
        blob.size <= TRAIT_THUMB_TARGET_MAX_BYTES) {
      return blob;
    }
    if (blob.size >= 8_000 && (!best || blob.size > best.size)) {
      best = blob;
    }
  }

  if (best) return best;
  return encodeWebpFromBlob(sourceBlob, TRAIT_THUMB_MAX_PX, 0.92);
}

function thumbFileName(thumbPath) {
  return thumbPath.slice(thumbPath.lastIndexOf("/") + 1);
}

async function getExistingThumbMeta(thumbPath) {
  const dir = thumbPath.slice(0, thumbPath.lastIndexOf("/"));
  const name = thumbFileName(thumbPath);
  const { data } = await supabase.storage.from("layer-assets").list(dir, {
    search: name,
    limit: 1,
  });
  const entry = data?.find((f) => f.name === name);
  return entry?.metadata?.size ?? entry?.metadata?.contentLength ?? null;
}

/**
 * Ensure a v2 WebP thumb exists beside the PNG (512px, ~25–50 KB target).
 */
export async function ensureTraitThumb(storagePath, { force = false } = {}) {
  const thumbPath = traitThumbPath(storagePath);
  if (!force) {
    const size = await getExistingThumbMeta(thumbPath);
    if (size != null) return thumbPath;
  }

  const { data, error } = await supabase.storage
    .from("layer-assets")
    .download(storagePath);
  if (error || !data) return null;

  const source =
    data instanceof Blob ? data : await data.blob?.().catch(() => null);
  if (!source) return null;

  const webp = await createTraitWebpThumb(source);
  const { error: uploadError } = await supabase.storage
    .from("layer-assets")
    .upload(thumbPath, webp, { contentType: "image/webp", upsert: true });
  if (uploadError) return null;
  return thumbPath;
}

export async function ensureTraitThumbs(storagePaths, options = {}) {
  const { concurrency = 3, onProgress, force = false } = options;
  const paths = [...new Set(storagePaths.filter(Boolean))];
  let done = 0;
  let index = 0;

  async function worker() {
    while (index < paths.length) {
      const i = index++;
      try {
        await ensureTraitThumb(paths[i], { force });
      } catch {
        // non-fatal per trait
      }
      done++;
      onProgress?.(done, paths.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, () => worker())
  );
}
