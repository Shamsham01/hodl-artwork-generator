const fs = require("fs");
const path = require("path");

const getRarityWeight = (str, rarityDelimiter = "#") => {
  const nameWithoutExtension = str.slice(0, -4);
  let weight = Number(nameWithoutExtension.split(rarityDelimiter).pop());
  if (isNaN(weight)) weight = 100;
  return weight;
};

const cleanName = (str, rarityDelimiter = "#") => {
  const nameWithoutExtension = str.slice(0, -4);
  return nameWithoutExtension.split(rarityDelimiter).shift();
};

const parseTraitFilename = (filename, rarityDelimiter = "#") => ({
  name: cleanName(filename, rarityDelimiter),
  weight: getRarityWeight(filename, rarityDelimiter),
  filename,
});

const getElements = (layerPath, rarityDelimiter = "#") => {
  if (!fs.existsSync(layerPath)) return [];
  return fs
    .readdirSync(layerPath)
    .filter((item) => !/(^|\/)\.[^\/\.]/g.test(item))
    .filter((item) => /\.(png|jpg|jpeg|gif)$/i.test(item))
    .map((filename, index) => {
      if (filename.includes("-")) {
        throw new Error(
          `layer name can not contain dashes, please fix: ${filename}`
        );
      }
      const parsed = parseTraitFilename(filename, rarityDelimiter);
      return {
        id: index,
        name: parsed.name,
        filename: parsed.filename,
        path: path.join(layerPath, filename),
        weight: parsed.weight,
      };
    });
};

const layersSetup = (layersOrder, layersDir, rarityDelimiter = "#") => {
  return layersOrder.map((layerObj, index) => ({
    id: index,
    layerKey: layerObj.name,
    elements: getElements(
      path.join(layersDir, layerObj.name),
      rarityDelimiter
    ),
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
  }));
};

const scanLayers = (layersDir, config) => {
  const rarityDelimiter = config.rarityDelimiter || "#";
  const layersOrder =
    config.layerConfigurations?.[0]?.layersOrder || [];
  const layers = layersSetup(layersOrder, layersDir, rarityDelimiter);

  return layers.map((layer) => {
    const totalWeight = layer.elements.reduce((sum, e) => sum + e.weight, 0);
    const elementsWithPct = layer.elements.map((e) => ({
      ...e,
      percentage: totalWeight > 0 ? (e.weight / totalWeight) * 100 : 0,
    }));
    return {
      ...layer,
      elements: elementsWithPct,
      totalWeight,
    };
  });
};

/**
 * Build layers from in-memory trait definitions (for Supabase-backed projects).
 * traitsByLayer: { BACKGROUND: [{ name, filename, path, weight, id }] }
 */
const layersFromTraits = (layersOrder, traitsByLayer) => {
  return layersOrder.map((layerObj, index) => {
    const layerKey = layerObj.name;
    const elements = (traitsByLayer[layerKey] || []).map((t, i) => ({
      id: t.id ?? i,
      name: t.name,
      filename: t.filename,
      path: t.path,
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
        layerObj.options?.opacity !== undefined
          ? layerObj.options.opacity
          : 1,
      bypassDNA:
        layerObj.options?.bypassDNA !== undefined
          ? layerObj.options.bypassDNA
          : false,
    };
  });
};

module.exports = {
  getRarityWeight,
  cleanName,
  parseTraitFilename,
  getElements,
  layersSetup,
  scanLayers,
  layersFromTraits,
};
