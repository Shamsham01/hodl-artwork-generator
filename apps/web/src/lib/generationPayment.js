import {
  Address,
  Token,
  TokenTransfer,
  TransactionsFactoryConfig,
  TransferTransactionsFactory,
} from "@multiversx/sdk-core";
import { getAccountProvider } from "@multiversx/sdk-dapp/out/providers/helpers/accountProvider";
import { TransactionManager } from "@multiversx/sdk-dapp/out/managers/TransactionManager";
import { refreshAccount } from "@multiversx/sdk-dapp/out/utils/account/refreshAccount";
import {
  GAS_PRICE,
  VERSION,
} from "@multiversx/sdk-dapp/out/constants/mvx.constants";

export const GENERATION_TOKEN_ID =
  import.meta.env.VITE_GENERATION_PAYMENT_TOKEN || "USDC-c76f1f";

export const GENERATION_TREASURY =
  import.meta.env.VITE_GENERATION_PAYMENT_TREASURY ||
  "erd158k2c3aserjmwnyxzpln24xukl2fsvlk9x46xae4dxl5xds79g6sdz37qn";

const TOKEN_DECIMALS = parseInt(
  import.meta.env.VITE_GENERATION_PAYMENT_DECIMALS || "6",
  10
);

const BUCKET_SIZE = 100;
const USDC_PER_BUCKET = 0.5;

const PAYMENT_API =
  import.meta.env.VITE_GENERATION_PAYMENT_API_URL ||
  "https://api.multiversx.com";

export function isGenerationPaymentDisabled() {
  return import.meta.env.VITE_GENERATION_PAYMENT_DISABLED === "true";
}

/** Editions are billed in 100-edition buckets (rounded up). */
export function calculateGenerationCharge(editionCount) {
  const editions = Math.max(1, Math.floor(Number(editionCount) || 0));
  const buckets = Math.ceil(editions / BUCKET_SIZE);
  const amountUsdc = buckets * USDC_PER_BUCKET;
  const amountAtomic = BigInt(
    Math.round(amountUsdc * 10 ** TOKEN_DECIMALS)
  );
  return {
    editions,
    buckets,
    amountUsdc,
    amountAtomic,
    displayAmount: formatUsdcAmount(amountUsdc),
  };
}

export function formatUsdcAmount(amountUsdc) {
  const text =
    amountUsdc % 1 === 0 ? String(amountUsdc) : amountUsdc.toFixed(1);
  return `${text} ${GENERATION_TOKEN_ID}`;
}

async function waitForTransactionSuccess(txHash, { maxAttempts = 45 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(`${PAYMENT_API}/transactions/${txHash}`, {
      headers: { "User-Agent": "BasturdsStudio/1.0" },
    });
    if (!res.ok) {
      await sleep(2000);
      continue;
    }
    const tx = await res.json();
    if (tx.status === "success") return tx;
    if (tx.status === "fail" || tx.status === "invalid") {
      throw new Error("Payment transaction failed on-chain.");
    }
    await sleep(2000);
  }
  throw new Error("Payment confirmation timed out. Try again in a moment.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prompts the connected wallet to send the generation fee, then waits for success.
 * @returns {Promise<string>} transaction hash
 */
export async function sendGenerationPayment({
  senderAddress,
  nonce,
  chainId,
  editionCount,
}) {
  if (isGenerationPaymentDisabled()) {
    return null;
  }

  if (!senderAddress) {
    throw new Error("Connect your MultiversX wallet to pay the generation fee.");
  }

  const charge = calculateGenerationCharge(editionCount);
  if (charge.amountAtomic <= 0n) {
    throw new Error("Invalid generation charge.");
  }

  await refreshAccount();

  const factory = new TransferTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId }),
  });

  const transaction = await factory.createTransactionForESDTTokenTransfer(
    Address.newFromBech32(senderAddress),
    {
      receiver: Address.newFromBech32(GENERATION_TREASURY),
      tokenTransfers: [
        new TokenTransfer({
          token: new Token({ identifier: GENERATION_TOKEN_ID }),
          amount: charge.amountAtomic,
        }),
      ],
    }
  );

  transaction.nonce = BigInt(nonce);
  transaction.gasPrice = BigInt(GAS_PRICE);
  transaction.version = VERSION;

  const provider = getAccountProvider();
  const signedTransactions = await provider.signTransactions([transaction]);
  const txManager = TransactionManager.getInstance();
  const sent = await txManager.send(signedTransactions);
  const flat = Array.isArray(sent[0]) ? sent.flat() : sent;
  const txHash = flat[0]?.hash;
  if (!txHash) {
    throw new Error("Could not obtain payment transaction hash.");
  }

  await waitForTransactionSuccess(txHash);
  return txHash;
}
