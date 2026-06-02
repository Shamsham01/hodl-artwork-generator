export const getRarityWeight = (str, rarityDelimiter = "#") => {
  const nameWithoutExtension = str.slice(0, -4);
  let weight = Number(nameWithoutExtension.split(rarityDelimiter).pop());
  if (isNaN(weight)) weight = 1;
  return weight;
};

export const cleanName = (str, rarityDelimiter = "#") => {
  const nameWithoutExtension = str.slice(0, -4);
  return nameWithoutExtension.split(rarityDelimiter).shift();
};

export const parseTraitFilename = (filename, rarityDelimiter = "#") => ({
  name: cleanName(filename, rarityDelimiter),
  weight: getRarityWeight(filename, rarityDelimiter),
  filename,
});

/**
 * Build layers from in-memory trait definitions (Supabase / browser cache).
 * traitsByLayer: { BACKGROUND: [{ name, filename, path, weight, id, imageSource? }] }
 */
export const layersFromTraits = (layersOrder, traitsByLayer) => {
  return layersOrder.map((layerObj, index) => {
    const layerKey = layerObj.name;
    const elements = (traitsByLayer[layerKey] || []).map((t, i) => ({
      id: t.id ?? i,
      name: t.name,
      filename: t.filename,
      path: t.path,
      imageSource: t.imageSource,
      weight: t.weight ?? 1,
    }));

    return {
      id: index,
      layerKey,
      elements,
      name:
        layerObj.options?.displayName !== undefined
          ? layerObj.options.displayName
          : layerObj.name,
      blend:
        layerObj.options?.blend !== undefined
          ? layerObj.options.blend
          : "source-over",
      opacity:
        layerObj.options?.opacity !== undefined ? layerObj.options.opacity : 1,
      bypassDNA:
        layerObj.options?.bypassDNA !== undefined
          ? layerObj.options.bypassDNA
          : false,
    };
  });
};

export const resolveLayersForOrder = (
  layersOrder,
  traitsByLayer,
  rarityDelimiter
) => {
  if (traitsByLayer) {
    return layersFromTraits(layersOrder, traitsByLayer);
  }
  throw new Error("traitsByLayer required in browser / cloud mode");
};

export const resolveLayers = (config, traitsByLayer) => {
  const layersOrder = config.layerConfigurations[0].layersOrder;
  return resolveLayersForOrder(
    layersOrder,
    traitsByLayer,
    config.rarityDelimiter
  );
};
