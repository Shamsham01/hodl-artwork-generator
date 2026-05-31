const basePath = process.cwd();
const { MODE } = require(`${basePath}/constants/blend_mode.js`);
const { NETWORK } = require(`${basePath}/constants/network.js`);

const network = NETWORK.mvx;

// General metadata for MultiversX
const namePrefix = "Your Collection";
const description = "Remember to replace this description";
const baseUri = "ipfs://NewUriToReplace";

const solanaMetadata = {
  symbol: "YC",
  seller_fee_basis_points: 1000, // Define how much % you want from secondary market sales 1000 = 10%
  external_url: "https://www.youtube.com/c/hashlipsnft",
  creators: [
    {
      address: "7fXNuer5sbZtaTEPhtJ5g5gNtuyRoKkvxdjEjEnPN4mC",
      share: 100,
    },
  ],
};

// If you have selected Solana then the collection starts from 0 automatically
const layerConfigurations = [
  {
    growEditionSizeTo: 1000,
    layersOrder: [
      { name: "BACKGROUND" },
      { name: "SKIN" },
      { name: "BEARD" },
      { name: "EYES" },
      { name: "HEAD" },
      { name: "MOUTH" },
      { name: "SUITS" },
    ],
  },
];

/**
 * Layer restrictions: when certain elements are selected, exclude other layers or elements.
 *
 * excludeLayers: entire layers are not drawn and not in metadata.
 *   when: { layer: "LAYER_NAME", element: "ElementName" }
 *   excludeLayers: ["LAYER_TO_HIDE", ...]
 *
 * excludeElements: specific elements within a layer are excluded from being picked.
 *   when: { layer: "LAYER_NAME", element: "ElementName" }
 *   excludeElements: { "AFFECTED_LAYER": ["ElementA", "ElementB", ...] }
 *   Use when the trigger layer is picked after the affected layer (e.g. EYES before SKIN in draw order).
 *
 * Example: when MOUTH is Gag, do not render BEARD
 * Example: when EYES is Three, do not allow PinkNose, OrangeNose, GreyNose from SKIN
 */
const layerRestrictions = [
  { when: { layer: "MOUTH", element: "Gag" }, excludeLayers: ["BEARD"] },
  {
    when: { layer: "EYES", element: "Three" },
    excludeElements: { SKIN: ["PinkNose", "OrangeNose", "GreyNose"] },
  },
  {
    when: { layer: "BEARD", element: "LilBeard" },
    excludeElements: { MOUTH: ["TongueRed"] },
  },
];

const shuffleLayerConfigurations = false;

const debugLogs = false;

const format = {
  width: 512,
  height: 512,
  smoothing: false,
};

const gif = {
  export: false,
  repeat: 0,
  quality: 100,
  delay: 500,
};

const text = {
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

const pixelFormat = {
  ratio: 2 / 128,
};

const background = {
  generate: true,
  brightness: "80%",
  static: false,
  default: "#000000",
};

const extraMetadata = {};

const rarityDelimiter = "#";

const uniqueDnaTorrance = 10000;

const preview = {
  thumbPerRow: 5,
  thumbWidth: 50,
  imageRatio: format.height / format.width,
  imageName: "preview.png",
};

const preview_gif = {
  numberOfImages: 5,
  order: "ASC", // ASC, DESC, MIXED
  repeat: 0,
  quality: 100,
  delay: 500,
  imageName: "preview.gif",
};

module.exports = {
  format,
  baseUri,
  description,
  background,
  uniqueDnaTorrance,
  layerConfigurations,
  layerRestrictions,
  rarityDelimiter,
  preview,
  shuffleLayerConfigurations,
  debugLogs,
  extraMetadata,
  pixelFormat,
  text,
  namePrefix,
  network,
  solanaMetadata,
  gif,
  preview_gif,
};
