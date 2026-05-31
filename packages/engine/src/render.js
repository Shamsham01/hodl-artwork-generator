const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { layersSetup, layersFromTraits } = require("./layers");
const {
  createRestrictionHelpers,
  constructLayerToDna,
  dnaFromSelections,
  isDnaUnique,
  filterDNAOptions,
} = require("./dna");
const { buildMetadata, buildAttributes } = require("./metadata");
const { NETWORK } = require("./constants/network");

const defaultFormat = {
  width: 512,
  height: 512,
  smoothing: false,
};

const defaultBackground = {
  generate: true,
  brightness: "80%",
  static: false,
  default: "#000000",
};

const defaultText = {
  only: false,
  color: "#ffffff",
  size: 20,
  xGap: 40,
  yGap: 40,
  align: "left",
  baseline: "top",
  weight: "regular",
  family: "Courier",
  spacer: " => ",
};

function shuffle(array) {
  const arr = [...array];
  let currentIndex = arr.length;
  while (currentIndex != 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [arr[currentIndex], arr[randomIndex]] = [
      arr[randomIndex],
      arr[currentIndex],
    ];
  }
  return arr;
}

const resolveLayersForOrder = (layersOrder, layersDir, traitsByLayer, rarityDelimiter) => {
  if (traitsByLayer) {
    return layersFromTraits(layersOrder, traitsByLayer);
  }
  return layersSetup(layersOrder, layersDir, rarityDelimiter || "#");
};

const resolveLayers = (config, layersDir, traitsByLayer) => {
  const layersOrder = config.layerConfigurations[0].layersOrder;
  return resolveLayersForOrder(
    layersOrder,
    layersDir,
    traitsByLayer,
    config.rarityDelimiter
  );
};

const createRenderer = (config, layersDir, traitsByLayer = null) => {
  const format = { ...defaultFormat, ...config.format };
  const background = { ...defaultBackground, ...config.background };
  const text = { ...defaultText, ...config.text };
  const layerRestrictions = config.layerRestrictions || [];
  const restrictionHelpers = createRestrictionHelpers(layerRestrictions);
  const { getExcludedLayerNames } = restrictionHelpers;

  const canvas = createCanvas(format.width, format.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = format.smoothing;

  const genColor = () => {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 100%, ${background.brightness})`;
  };

  const drawBackground = () => {
    ctx.fillStyle = background.static ? background.default : genColor();
    ctx.fillRect(0, 0, format.width, format.height);
  };

  const addText = (sig, x, y, size) => {
    ctx.fillStyle = text.color;
    ctx.font = `${text.weight} ${size}pt ${text.family}`;
    ctx.textBaseline = text.baseline;
    ctx.textAlign = text.align;
    ctx.fillText(sig, x, y);
  };

  const drawElement = (renderObject, index) => {
    ctx.globalAlpha = renderObject.layer.opacity;
    ctx.globalCompositeOperation = renderObject.layer.blend;
    if (text.only) {
      addText(
        `${renderObject.layer.name}${text.spacer}${renderObject.layer.selectedElement.name}`,
        text.xGap,
        text.yGap * (index + 1),
        text.size
      );
    } else {
      ctx.drawImage(
        renderObject.loadedImage,
        0,
        0,
        format.width,
        format.height
      );
    }
  };

  const loadLayerImg = async (layer) => {
    const image = await loadImage(layer.selectedElement.path);
    return { layer, loadedImage: image };
  };

  const renderToBuffer = async (dna, layers) => {
    const results = constructLayerToDna(dna, layers);
    const loadedElements = await Promise.all(results.map(loadLayerImg));

    ctx.clearRect(0, 0, format.width, format.height);
    if (background.generate) {
      drawBackground();
    }

    const excludedLayers = getExcludedLayerNames(loadedElements);
    const layersToRender = loadedElements.filter(
      (ro) => !excludedLayers.has(ro.layer.layerKey || ro.layer.name)
    );

    layersToRender.forEach((renderObject, index) => {
      drawElement(renderObject, index);
    });

    const attributes = buildAttributes(layersToRender);
    return {
      buffer: canvas.toBuffer("image/png"),
      attributes,
      dna,
    };
  };

  return {
    format,
    resolveLayers: () => resolveLayers(config, layersDir, traitsByLayer),
    renderToBuffer,
    restrictionHelpers,
  };
};

const renderSingle = async (config, options = {}) => {
  const {
    layersDir,
    traitsByLayer,
    dna,
    selectedTraits,
    edition = 1,
  } = options;

  const renderer = createRenderer(config, layersDir, traitsByLayer);
  const layers = renderer.resolveLayers();
  const { createDna } = renderer.restrictionHelpers;

  let finalDna = dna;
  if (!finalDna && selectedTraits) {
    finalDna = dnaFromSelections(layers, selectedTraits);
  }
  if (!finalDna) {
    finalDna = createDna(layers);
  }

  const { buffer, attributes } = await renderer.renderToBuffer(finalDna, layers);
  const metadata = buildMetadata(config, finalDna, edition, attributes);

  return {
    buffer,
    dna: finalDna,
    metadata,
    attributes,
  };
};

const renderBatch = async (config, options = {}) => {
  const {
    layersDir,
    traitsByLayer,
    outputDir,
    onProgress,
    onEdition,
  } = options;

  const network = config.network || NETWORK.eth;
  const uniqueDnaTorrance = config.uniqueDnaTorrance || 10000;
  const shuffleLayerConfigurations = config.shuffleLayerConfigurations || false;
  const rarityDelimiter = config.rarityDelimiter || "#";

  const renderer = createRenderer(config, layersDir, traitsByLayer);
  const { createDna } = renderer.restrictionHelpers;

  const imagesDir = path.join(outputDir, "images");
  const jsonDir = path.join(outputDir, "json");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(jsonDir, { recursive: true });

  const layerConfigurations = config.layerConfigurations;
  // growEditionSizeTo is cumulative across configurations (HashLips behaviour).
  const totalEditions =
    layerConfigurations[layerConfigurations.length - 1].growEditionSizeTo;
  const startIndex = network === NETWORK.sol ? 0 : 1;

  let abstractedIndexes = [];
  for (let i = startIndex; i < startIndex + totalEditions; i++) {
    abstractedIndexes.push(i);
  }
  if (shuffleLayerConfigurations) {
    abstractedIndexes = shuffle(abstractedIndexes);
  }

  const dnaList = new Set();
  const metadataList = [];
  let failedCount = 0;
  let completed = 0; // total editions generated so far (across all configs)

  for (
    let layerConfigIndex = 0;
    layerConfigIndex < layerConfigurations.length;
    layerConfigIndex++
  ) {
    const layerConfig = layerConfigurations[layerConfigIndex];
    const layers = resolveLayersForOrder(
      layerConfig.layersOrder,
      layersDir,
      traitsByLayer,
      rarityDelimiter
    );

    while (completed < layerConfig.growEditionSizeTo) {
      const edition = abstractedIndexes[0];
      const newDna = createDna(layers);

      if (!isDnaUnique(dnaList, newDna)) {
        failedCount++;
        if (failedCount >= uniqueDnaTorrance) {
          throw new Error(
            `Cannot grow edition to ${layerConfig.growEditionSizeTo}: not enough unique combinations`
          );
        }
        continue;
      }

      const { buffer, attributes } = await renderer.renderToBuffer(
        newDna,
        layers
      );
      const metadata = buildMetadata(config, newDna, edition, attributes);

      fs.writeFileSync(path.join(imagesDir, `${edition}.png`), buffer);
      fs.writeFileSync(
        path.join(jsonDir, `${edition}.json`),
        JSON.stringify(metadata, null, 2)
      );

      dnaList.add(filterDNAOptions(newDna));
      metadataList.push(metadata);
      completed++;
      abstractedIndexes.shift();
      failedCount = 0;

      if (onProgress) {
        onProgress({ completed, total: totalEditions, edition });
      }
      if (onEdition) {
        onEdition({ edition, dna: newDna, metadata, buffer });
      }
    }
  }

  fs.writeFileSync(
    path.join(jsonDir, "_metadata.json"),
    JSON.stringify(metadataList, null, 2)
  );

  return { metadataList, editionCount: completed };
};

const buildSetup = (buildDir, gifExport = false) => {
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true });
  }
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(path.join(buildDir, "json"), { recursive: true });
  fs.mkdirSync(path.join(buildDir, "images"), { recursive: true });
  if (gifExport) {
    fs.mkdirSync(path.join(buildDir, "gifs"), { recursive: true });
  }
};

module.exports = {
  createRenderer,
  renderSingle,
  renderBatch,
  buildSetup,
  resolveLayers,
  resolveLayersForOrder,
};
