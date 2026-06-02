import { supabase } from "./supabase";

export function traitThumbPath(storagePath) {
  const slash = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slash);
  const file = storagePath
    .slice(slash + 1)
    .replace(/\.(png|jpe?g|gif)$/i, ".webp");
  return `${dir}/thumbs/${file}`;
}

const MAX_CONCURRENT = 6;
let inFlight = 0;
const waitQueue = [];

function pumpQueue() {
  while (inFlight < MAX_CONCURRENT && waitQueue.length > 0) {
    const next = waitQueue.shift();
    inFlight++;
    next()
      .catch(() => {})
      .finally(() => {
        inFlight--;
        pumpQueue();
      });
  }
}

function runThrottled(fn) {
  return new Promise((resolve, reject) => {
    waitQueue.push(() => fn().then(resolve, reject));
    pumpQueue();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStorageError(error) {
  if (!error) return false;
  const status = error.statusCode ?? error.status;
  if (status === 502 || status === 503 || status === 504 || status === 429) {
    return true;
  }
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("bad gateway") ||
    msg.includes("gateway") ||
    msg.includes("timeout") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("fetch failed")
  );
}

function isNotFoundError(error) {
  const status = error?.statusCode ?? error?.status;
  if (status === 404 || status === 400) return true;
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("not found") || msg.includes("object not found");
}

/**
 * Download from layer-assets with retries (Supabase Storage often returns transient 502).
 * @param {string} storagePath - full PNG path in bucket
 * @param {{ preferThumb?: boolean, retries?: number }} options
 * @returns {Promise<Blob|null>}
 */
export async function downloadLayerAsset(storagePath, options = {}) {
  const { preferThumb = false, retries = 4 } = options;
  if (!storagePath) return null;

  const paths = preferThumb
    ? [traitThumbPath(storagePath), storagePath]
    : [storagePath, traitThumbPath(storagePath)];

  return runThrottled(async () => {
    let lastError = null;

    for (const path of paths) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        const { data, error } = await supabase.storage
          .from("layer-assets")
          .download(path);

        if (!error && data) {
          return data instanceof Blob ? data : await data.blob();
        }

        lastError = error;
        if (error && isNotFoundError(error)) break;

        if (attempt < retries && isRetryableStorageError(error)) {
          await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
          continue;
        }
        break;
      }
    }

    if (lastError) {
      console.warn(
        `[storage] download failed: ${storagePath}`,
        lastError.message || lastError
      );
    }
    return null;
  });
}
