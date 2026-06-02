import sha1 from "sha1";
import { NETWORK } from "./constants/network.js";

export { sha1 };

export const buildMetadata = (config, dna, edition, attributes) => {
  const {
    namePrefix = "Collection",
    description = "",
    baseUri = "",
    extraMetadata = {},
    network = NETWORK.eth,
    solanaMetadata = {},
  } = config;

  const dateTime = Date.now();
  let tempMetadata = {
    name: `${namePrefix} #${edition}`,
    description,
    image: `${baseUri}/${edition}.png`,
    dna: sha1(dna),
    edition,
    date: dateTime,
    ...extraMetadata,
    attributes,
    compiler: "HashLips Art Engine",
  };

  if (network === NETWORK.sol) {
    tempMetadata = {
      name: tempMetadata.name,
      symbol: solanaMetadata.symbol,
      description: tempMetadata.description,
      seller_fee_basis_points: solanaMetadata.seller_fee_basis_points,
      image: `${edition}.png`,
      external_url: solanaMetadata.external_url,
      edition,
      ...extraMetadata,
      attributes: tempMetadata.attributes,
      properties: {
        files: [{ uri: `${edition}.png`, type: "image/png" }],
        category: "image",
        creators: solanaMetadata.creators,
      },
    };
  }

  return tempMetadata;
};

export const buildAttributes = (renderObjects) => {
  return renderObjects
    .filter((ro) => ro.layer.selectedElement)
    .map((ro) => ({
      trait_type: ro.layer.name,
      value: ro.layer.selectedElement.name,
    }));
};
