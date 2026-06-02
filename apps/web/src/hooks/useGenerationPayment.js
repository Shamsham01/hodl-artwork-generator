import { useCallback } from "react";
import { useGetAccount } from "@multiversx/sdk-dapp/out/react/account/useGetAccount";
import { useGetAccountInfo } from "@multiversx/sdk-dapp/out/react/account/useGetAccountInfo";
import { useGetNetworkConfig } from "@multiversx/sdk-dapp/out/react/network/useGetNetworkConfig";
import { useAuth } from "../context/AuthContext";
import {
  calculateGenerationCharge,
  formatUsdcAmount,
  isGenerationPaymentDisabled,
  sendGenerationPayment,
} from "../lib/generationPayment";

export function useGenerationPayment() {
  const { walletAddress, connectWallet } = useAuth();
  const { address } = useGetAccountInfo();
  const account = useGetAccount();
  const { network } = useGetNetworkConfig();

  const payForEditions = useCallback(
    async (editionCount) => {
      if (isGenerationPaymentDisabled()) {
        return null;
      }

      const sender = address || walletAddress;
      if (!sender) {
        connectWallet();
        throw new Error(
          "Connect your MultiversX wallet to pay the generation fee."
        );
      }

      return sendGenerationPayment({
        senderAddress: sender,
        nonce: account.nonce,
        chainId: network.chainId,
        editionCount,
      });
    },
    [address, walletAddress, account.nonce, network.chainId, connectWallet]
  );

  return {
    paymentDisabled: isGenerationPaymentDisabled(),
    getCharge: calculateGenerationCharge,
    formatCharge: formatUsdcAmount,
    payForEditions,
  };
}
