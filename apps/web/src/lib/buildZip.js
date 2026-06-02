import { zipSync } from "fflate";
import { listEditionNumbers, getEdition } from "./traitCache.js";

function blobToUint8(blob) {
  return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/**
 * Build a collection zip from IndexedDB edition cache (images/ + json/).
 */
export async function buildCollectionZip(jobId, { metadataList = null } = {}) {
  const editionNumbers = await listEditionNumbers(jobId);
  if (!editionNumbers.length && !metadataList?.length) {
    throw new Error("No editions found — generate or resume the collection first.");
  }

  const files = {};
  const metaByEdition = new Map();

  if (metadataList?.length) {
    for (const m of metadataList) {
      metaByEdition.set(m.edition, m);
    }
  }

  for (const num of editionNumbers) {
    const row = await getEdition(jobId, num);
    if (!row) continue;
    const meta = metaByEdition.get(num) || row.metadata;
    const png = await blobToUint8(row.pngBlob);
    files[`images/${num}.png`] = png;
    files[`json/${num}.json`] = new TextEncoder().encode(
      JSON.stringify(meta, null, 2)
    );
  }

  const allMeta = editionNumbers.map((num) => {
    const row = metaByEdition.get(num);
    if (row) return row;
    return null;
  }).filter(Boolean);

  if (allMeta.length) {
    files["json/_metadata.json"] = new TextEncoder().encode(
      JSON.stringify(allMeta, null, 2)
    );
  } else {
    const collected = [];
    for (const num of editionNumbers) {
      const row = await getEdition(jobId, num);
      if (row?.metadata) collected.push(row.metadata);
    }
    if (collected.length) {
      files["json/_metadata.json"] = new TextEncoder().encode(
        JSON.stringify(collected, null, 2)
      );
    }
  }

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
