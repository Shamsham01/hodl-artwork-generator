import { EnvironmentsEnum } from "@multiversx/sdk-dapp/out/types/enums.types";

const network = import.meta.env.VITE_MVX_ENV || "devnet";
const walletConnectV2ProjectId =
  import.meta.env.VITE_WALLETCONNECT_V2_PROJECT_ID || "";

const apiAddressMap = {
  mainnet: "https://api.multiversx.com",
  testnet: "https://testnet-api.multiversx.com",
  devnet: "https://devnet-api.multiversx.com",
};
const explorerAddressMap = {
  mainnet: "https://explorer.multiversx.com",
  testnet: "https://testnet-explorer.multiversx.com",
  devnet: "https://devnet-explorer.multiversx.com",
};
const chainIdMap = { mainnet: "1", testnet: "T", devnet: "D" };
const environmentMap = {
  mainnet: EnvironmentsEnum.mainnet,
  testnet: EnvironmentsEnum.testnet,
  devnet: EnvironmentsEnum.devnet,
};

const dAppConfig = {
  nativeAuth: true,
  environment: environmentMap[network] || EnvironmentsEnum.devnet,
  network: {
    apiAddress: apiAddressMap[network] || apiAddressMap.devnet,
    explorerAddress: explorerAddressMap[network] || explorerAddressMap.devnet,
    chainId: chainIdMap[network] || chainIdMap.devnet,
  },
  theme: "mvx:dark-theme",
};

if (walletConnectV2ProjectId) {
  dAppConfig.providers = {
    walletConnect: { walletConnectV2ProjectId },
  };
}

export const initConfig = {
  storage: { getStorageCallback: () => window.localStorage },
  dAppConfig,
};
