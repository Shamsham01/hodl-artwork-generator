const { supabase } = require("../lib/supabase");

const TOKEN_ID =
  process.env.GENERATION_PAYMENT_TOKEN || "USDC-c76f1f";
const TREASURY =
  process.env.GENERATION_PAYMENT_TREASURY ||
  "erd158k2c3aserjmwnyxzpln24xukl2fsvlk9x46xae4dxl5xds79g6sdz37qn";
const TOKEN_DECIMALS = parseInt(
  process.env.GENERATION_PAYMENT_DECIMALS || "6",
  10
);
const MVX_API =
  process.env.GENERATION_PAYMENT_API_URL ||
  process.env.MVX_API_MAINNET ||
  "https://api.multiversx.com";

const BUCKET_SIZE = 100;
const USDC_PER_BUCKET = 0.5;

const PAYMENT_DISABLED =
  process.env.GENERATION_PAYMENT_DISABLED === "true";

function calculateGenerationCharge(editionCount) {
  const editions = Math.max(1, Math.floor(Number(editionCount) || 0));
  const buckets = Math.ceil(editions / BUCKET_SIZE);
  const amountUsdc = buckets * USDC_PER_BUCKET;
  const amountAtomic = BigInt(
    Math.round(amountUsdc * 10 ** TOKEN_DECIMALS)
  );
  return { editions, buckets, amountUsdc, amountAtomic };
}

function normalizeAddress(addr) {
  return (addr || "").toLowerCase();
}

function extractEsdtTransfer(tx) {
  const transfers = tx?.action?.arguments?.transfers;
  if (!Array.isArray(transfers) || transfers.length === 0) {
    return null;
  }
  const match = transfers.find(
    (t) => (t.token || t.identifier) === TOKEN_ID
  );
  if (!match) return null;
  return {
    token: match.token || match.identifier,
    value: BigInt(match.value || "0"),
    receiver: tx?.action?.arguments?.receiver || tx.receiver,
  };
}

async function fetchTransaction(txHash) {
  const res = await fetch(`${MVX_API}/transactions/${txHash}`, {
    headers: { "User-Agent": "BasturdsStudio/1.0" },
  });
  if (!res.ok) {
    throw new Error("Payment transaction not found on MultiversX.");
  }
  return res.json();
}

async function assertPaymentNotReused(txHash) {
  const { data } = await supabase
    .from("generation_payments")
    .select("id")
    .eq("tx_hash", txHash)
    .maybeSingle();
  if (data) {
    throw new Error("This payment transaction was already used.");
  }
}

async function recordPayment({
  txHash,
  walletAddress,
  projectId,
  editionCount,
  amountAtomic,
}) {
  const { error } = await supabase.from("generation_payments").insert({
    tx_hash: txHash,
    wallet_address: walletAddress,
    project_id: projectId,
    edition_count: editionCount,
    amount_atomic: amountAtomic.toString(),
    token_identifier: TOKEN_ID,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("This payment transaction was already used.");
    }
    throw error;
  }
}

async function resolveWalletAddress(user) {
  const fromMeta = user?.app_metadata?.wallet_address;
  if (fromMeta) return fromMeta;

  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_address")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.wallet_address || null;
}

/**
 * Verifies an on-chain USDC payment and records it before generation starts.
 */
async function verifyAndRecordGenerationPayment({
  paymentTxHash,
  editionCount,
  projectId,
  user,
}) {
  if (PAYMENT_DISABLED) {
    return { skipped: true };
  }

  if (!paymentTxHash || typeof paymentTxHash !== "string") {
    throw new Error("paymentTxHash is required.");
  }

  const walletAddress = await resolveWalletAddress(user);
  if (!walletAddress) {
    throw new Error("Wallet address not found for this account.");
  }

  const expected = calculateGenerationCharge(editionCount);
  await assertPaymentNotReused(paymentTxHash);

  const tx = await fetchTransaction(paymentTxHash);
  if (tx.status !== "success") {
    throw new Error("Payment transaction is not successful.");
  }

  if (normalizeAddress(tx.sender) !== normalizeAddress(walletAddress)) {
    throw new Error("Payment must be sent from your connected wallet.");
  }

  const transfer = extractEsdtTransfer(tx);
  if (!transfer) {
    throw new Error(`Payment must include a ${TOKEN_ID} transfer.`);
  }

  if (normalizeAddress(transfer.receiver) !== normalizeAddress(TREASURY)) {
    throw new Error("Payment was not sent to the HODL Token Club treasury.");
  }

  if (transfer.value < expected.amountAtomic) {
    const required =
      expected.amountUsdc % 1 === 0
        ? String(expected.amountUsdc)
        : expected.amountUsdc.toFixed(1);
    throw new Error(
      `Insufficient payment: ${required} ${TOKEN_ID} required for ${expected.editions} editions.`
    );
  }

  await recordPayment({
    txHash: paymentTxHash,
    walletAddress,
    projectId,
    editionCount: expected.editions,
    amountAtomic: transfer.value,
  });

  return { verified: true, amountAtomic: transfer.value.toString() };
}

module.exports = {
  calculateGenerationCharge,
  verifyAndRecordGenerationPayment,
  isGenerationPaymentDisabled: () => PAYMENT_DISABLED,
};
