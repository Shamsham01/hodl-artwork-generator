import { UnlockPanelManager } from "@multiversx/sdk-dapp/out/managers/UnlockPanelManager";
import { ProviderTypeEnum } from "@multiversx/sdk-dapp/out/providers/types/providerFactory.types";

const hasWalletConnectProjectId = Boolean(
  import.meta.env.VITE_WALLETCONNECT_V2_PROJECT_ID
);

const allowedProviders = hasWalletConnectProjectId
  ? undefined
  : [
      ProviderTypeEnum.extension,
      ProviderTypeEnum.crossWindow,
      ProviderTypeEnum.webview,
      ProviderTypeEnum.ledger,
      ProviderTypeEnum.passkey,
      ProviderTypeEnum.metamask,
    ];

let unlockPanelManager;

export function initWalletConnect() {
  if (!unlockPanelManager) {
    unlockPanelManager = UnlockPanelManager.init({
      loginHandler: () => {},
      allowedProviders,
    });
  }
  return unlockPanelManager;
}

export function openWalletConnect() {
  unlockPanelManager?.openUnlockPanel();
}
