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

    ctx.clearRect(0, 0, format.width, format.height);
    if (background.generate) {
      drawBackground();
    }

    const excludedLayers = getExcludedLayerNames(
      results.map((ro) => ({ layer: ro }))
    );
    const layersToRender = results.filter(
      (ro) => !excludedLayers.has(ro.layerKey || ro.name)
    );

    // Load and draw one layer at a time so large stacks (20+ layers) don't
    // decode every trait image into memory at once — a common OOM on 512 MB hosts.
    const loadedElements = [];
    for (let index = 0; index < layersToRender.length; index++) {
      const renderObject = await loadLayerImg(layersToRender[index]);
      drawElement(renderObject, index);
      loadedElements.push(renderObject);
    }

    const attributes = buildAttributes(loadedElements);
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
    resumeState = null,
  } = options;

  const network = config.network || NETWORK.eth;
  const uniqueDnaTorrance = config.uniqueDnaTorrance || 10000;
  const shuffleLayerConfigurations = config.shuffleLayerConfigurations || false;
  const rarityDelimiter = config.rarityDelimiter || "#";

  const renderer = createRenderer(config, layersDir, traitsByLayer);
  const { createDna } = renderer.restrictionHelpers;

  // When uploading each edition via onEdition (cloud worker), skip writing
  // PNG/JSON to /tmp — a 1000-edition run can exceed Render's 2 GB /tmp cap.
  const persistLocally = !onEdition;

  const imagesDir = persistLocally && outputDir ? path.join(outputDir, "images") : null;
  const jsonDir = persistLocally && outputDir ? path.join(outputDir, "json") : null;
  if (persistLocally) {
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(jsonDir, { recursive: true });
  }

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

  // Resume after a worker restart: skip editions already uploaded and seed the
  // DNA set so we don't regenerate duplicates.
  if (resumeState?.doneEditions?.size) {
    abstractedIndexes = abstractedIndexes.filter(
      (i) => !resumeState.doneEditions.has(i)
    );
  }

  const dnaList = resumeState?.dnaList ? new Set(resumeState.dnaList) : new Set();
  const metadataList = resumeState?.metadataList ? [...resumeState.metadataList] : [];
  let failedCount = 0;
  let completed = resumeState?.completed ?? 0;

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

      if (persistLocally) {
        fs.writeFileSync(path.join(imagesDir, `${edition}.png`), buffer);
        fs.writeFileSync(
          path.join(jsonDir, `${edition}.json`),
          JSON.stringify(metadata, null, 2)
        );
      }

      dnaList.add(filterDNAOptions(newDna));
      metadataList.push(metadata);
      completed++;
      abstractedIndexes.shift();
      failedCount = 0;

      // Must await so upload/thumbnail work finishes before the next render.
      // Firing these concurrently caused memory to spike and OOM-killed Render.
      if (onProgress) {
        await onProgress({ completed, total: totalEditions, edition });
      }
      if (onEdition) {
        await onEdition({ edition, dna: newDna, metadata, buffer });
      }
    }
  }

  if (persistLocally) {
    fs.writeFileSync(
      path.join(jsonDir, "_metadata.json"),
      JSON.stringify(metadataList, null, 2)
    );
  }

  return { metadataList, editionCount: completed };
};

/**
 * Produce a small WebP thumbnail from a full-size image buffer. Used to serve
 * the results gallery cheaply instead of repeatedly downloading full-resolution
 * renders from storage (the main source of egress).
 */
const createThumbnail = async (buffer, size = 256, quality = 72) => {
  const img = await loadImage(buffer);
  const ratio = Math.min(size / img.width, size / img.height, 1);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.encode("webp", quality);
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
  createThumbnail,
  buildSetup,
  resolveLayers,
  resolveLayersForOrder,
};
