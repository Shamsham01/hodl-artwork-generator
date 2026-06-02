import {
  createRestrictionHelpers,
  constructLayerToDna,
  dnaFromSelections,
  isDnaUnique,
  filterDNAOptions,
  buildMetadata,
  buildAttributes,
  resolveLayersForOrder,
  resolveLayers,
  NETWORK,
} from "@basturds/engine-core";

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

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadImageSource(source) {
  if (source instanceof ImageBitmap) return source;
  if (source instanceof Blob) {
    return createImageBitmap(source);
  }
  if (typeof source === "string") {
    const res = await fetch(source);
    const blob = await res.blob();
    return createImageBitmap(blob);
  }
  throw new Error("Unsupported image source");
}

async function canvasToPngBlob(canvas) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode PNG"));
    }, "image/png");
  });
}

async function canvasToWebpBlob(canvas, quality = 0.72) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: "image/webp", quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode WebP"));
      },
      "image/webp",
      quality
    );
  });
}

export const createRenderer = (config, traitsByLayer = null) => {
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
    const el = layer.selectedElement;
    const source = el.imageSource ?? el.path;
    const image = await loadImageSource(source);
    return { layer, loadedImage: image };
  };

  const renderToBlob = async (dna, layers) => {
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

    const loadedElements = [];
    for (let index = 0; index < layersToRender.length; index++) {
      const renderObject = await loadLayerImg(layersToRender[index]);
      drawElement(renderObject, index);
      loadedElements.push(renderObject);
      if (renderObject.loadedImage?.close) {
        renderObject.loadedImage.close();
      }
    }

    const attributes = buildAttributes(loadedElements);
    const blob = await canvasToPngBlob(canvas);
    return { blob, attributes, dna };
  };

  return {
    format,
    resolveLayers: () => resolveLayers(config, traitsByLayer),
    renderToBlob,
    restrictionHelpers,
  };
};

export const renderSingle = async (config, options = {}) => {
  const { traitsByLayer, dna, selectedTraits, edition = 1 } = options;

  const renderer = createRenderer(config, traitsByLayer);
  const layers = renderer.resolveLayers();
  const { createDna } = renderer.restrictionHelpers;

  let finalDna = dna;
  if (!finalDna && selectedTraits) {
    finalDna = dnaFromSelections(layers, selectedTraits);
  }
  if (!finalDna) {
    finalDna = createDna(layers);
  }

  const { blob, attributes } = await renderer.renderToBlob(finalDna, layers);
  const metadata = buildMetadata(config, finalDna, edition, attributes);

  return {
    blob,
    dna: finalDna,
    metadata,
    attributes,
  };
};

export const renderBatch = async (config, options = {}) => {
  const { traitsByLayer, onProgress, onEdition, resumeState = null } = options;

  const network = config.network || NETWORK.eth;
  const uniqueDnaTorrance = config.uniqueDnaTorrance || 10000;
  const shuffleLayerConfigurations = config.shuffleLayerConfigurations || false;
  const rarityDelimiter = config.rarityDelimiter || "#";

  const renderer = createRenderer(config, traitsByLayer);
  const { createDna } = renderer.restrictionHelpers;

  const layerConfigurations = config.layerConfigurations;
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

      const { blob, attributes } = await renderer.renderToBlob(newDna, layers);
      const metadata = buildMetadata(config, newDna, edition, attributes);

      dnaList.add(filterDNAOptions(newDna));
      metadataList.push(metadata);
      completed++;
      abstractedIndexes.shift();
      failedCount = 0;

      if (onProgress) {
        await onProgress({ completed, total: totalEditions, edition });
      }
      if (onEdition) {
        await onEdition({ edition, dna: newDna, metadata, blob });
      }
    }
  }

  return { metadataList, editionCount: completed };
};

export const createThumbnail = async (pngBlob, size = 256, quality = 0.72) => {
  const img = await loadImageSource(pngBlob);
  const ratio = Math.min(size / img.width, size / img.height, 1);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  if (img.close) img.close();
  return canvasToWebpBlob(canvas, quality);
};

export { resolveLayers, resolveLayersForOrder };
