import { renderBatch, createThumbnail } from "@basturds/engine-browser";
import { filterDNAOptions } from "@basturds/engine-core";
import { getTraitBlob } from "../lib/traitCache.js";

async function buildTraitsByLayer(traitDefsByLayer) {
  const traitsByLayer = {};
  for (const [layerName, traits] of Object.entries(traitDefsByLayer)) {
    traitsByLayer[layerName] = [];
    for (let i = 0; i < traits.length; i++) {
      const t = traits[i];
      const blob = await getTraitBlob(t.storage_path);
      if (!blob) {
        throw new Error(`Trait not cached: ${t.storage_path}`);
      }
      traitsByLayer[layerName].push({
        id: i,
        name: t.name,
        filename: t.filename,
        path: t.storage_path,
        imageSource: blob,
        weight: t.weight ?? 1,
      });
    }
  }
  return traitsByLayer;
}

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === "run") {
    const { config, traitDefsByLayer, resumeState, editionSize } = payload;

    try {
      if (config.layerConfigurations.length === 1) {
        config.layerConfigurations[0].growEditionSizeTo = editionSize;
      }

      const traitsByLayer = await buildTraitsByLayer(traitDefsByLayer);

      await renderBatch(config, {
        traitsByLayer,
        resumeState,
        onProgress: async ({ completed, total, edition }) => {
          self.postMessage({ type: "progress", completed, total, edition });
        },
        onEdition: async ({ edition, dna, metadata, blob }) => {
          let thumbBlob = null;
          try {
            thumbBlob = await createThumbnail(blob, 256);
          } catch {
            // optional
          }
          self.postMessage({
            type: "edition",
            edition,
            dna,
            metadata,
            blob,
            thumbBlob,
          });
        },
      });

      self.postMessage({ type: "complete" });
    } catch (err) {
      self.postMessage({ type: "error", message: err.message || String(err) });
    }
  }

  if (type === "resumeDna") {
    self.postMessage({
      type: "resumeDna",
      dnaList: payload.dnaList?.map((d) => filterDNAOptions(d)),
    });
  }
};
