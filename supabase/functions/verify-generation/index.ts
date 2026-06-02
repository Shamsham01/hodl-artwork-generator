import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "https://hodl-artwork-generator.netlify.app",
  "http://bot-service-eu-central-04.cybrancee.com:5028",
];

function acceptedOrigins(): string[] {
  const raw = Deno.env.get("MVX_ALLOWED_ORIGINS");
  const fromEnv = raw
    ? raw.split(",").map((o) => o.trim()).filter(Boolean)
    : [];
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowed = acceptedOrigins();
  const match = allowed.includes(origin)
    ? origin
    : allowed.find((o) => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": match || allowed[0] || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const TOKEN_ID =
  Deno.env.get("GENERATION_PAYMENT_TOKEN") || "USDC-c76f1f";
const TREASURY =
  Deno.env.get("GENERATION_PAYMENT_TREASURY") ||
  "erd158k2c3aserjmwnyxzpln24xukl2fsvlk9x46xae4dxl5xds79g6sdz37qn";
const TOKEN_DECIMALS = parseInt(
  Deno.env.get("GENERATION_PAYMENT_DECIMALS") || "6",
  10
);
const MVX_API =
  Deno.env.get("GENERATION_PAYMENT_API_URL") ||
  Deno.env.get("MVX_API_MAINNET") ||
  "https://api.multiversx.com";
const PAYMENT_DISABLED =
  Deno.env.get("GENERATION_PAYMENT_DISABLED") === "true";
const BUCKET_SIZE = 100;
const USDC_PER_BUCKET = 0.5;
const MAX_EDITION_SIZE = parseInt(
  Deno.env.get("MAX_EDITION_SIZE") || "10000",
  10
);

function calculateGenerationCharge(editionCount: number) {
  const editions = Math.max(1, Math.floor(Number(editionCount) || 0));
  const buckets = Math.ceil(editions / BUCKET_SIZE);
  const amountUsdc = buckets * USDC_PER_BUCKET;
  const amountAtomic = BigInt(
    Math.round(amountUsdc * 10 ** TOKEN_DECIMALS)
  );
  return { editions, buckets, amountUsdc, amountAtomic };
}

function normalizeAddress(addr: string) {
  return (addr || "").toLowerCase();
}

function extractEsdtTransfer(tx: Record<string, unknown>) {
  const action = tx?.action as Record<string, unknown> | undefined;
  const args = action?.arguments as Record<string, unknown> | undefined;
  const transfers = args?.transfers as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(transfers) || transfers.length === 0) return null;
  const match = transfers.find(
    (t) => (t.token || t.identifier) === TOKEN_ID
  );
  if (!match) return null;
  return {
    token: (match.token || match.identifier) as string,
    value: BigInt((match.value as string) || "0"),
    receiver: (args?.receiver as string) || (tx.receiver as string),
  };
}

async function fetchTransaction(txHash: string) {
  const res = await fetch(`${MVX_API}/transactions/${txHash}`, {
    headers: { "User-Agent": "BasturdsStudio/1.0" },
  });
  if (!res.ok) throw new Error("Payment transaction not found on MultiversX.");
  return res.json();
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Missing authorization");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { projectId, editionSize, paymentTxHash, regenerate } = body;

    if (!projectId) throw new Error("projectId required");

    const { data: project } = await admin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("owner_id", user.id)
      .single();

    if (!project) throw new Error("Project not found");

    const { data: layerConfigs } = await admin
      .from("layer_configurations")
      .select("edition_count")
      .eq("project_id", projectId);

    const size =
      layerConfigs && layerConfigs.length
        ? layerConfigs.reduce(
            (sum: number, c: { edition_count: number }) =>
              sum + (c.edition_count || 0),
            0
          )
        : editionSize || project.edition_size;

    if (!size || size < 1) throw new Error("Edition size must be at least 1");
    if (size > MAX_EDITION_SIZE) {
      throw new Error(`Max edition size is ${MAX_EDITION_SIZE}`);
    }

    const { data: runningJobs } = await admin
      .from("generation_jobs")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["queued", "running"]);

    if (runningJobs?.length && !regenerate) {
      throw new Error("Generation already in progress");
    }

    if (!PAYMENT_DISABLED) {
      if (!paymentTxHash) throw new Error("paymentTxHash is required");

      const { data: existingPay } = await admin
        .from("generation_payments")
        .select("id")
        .eq("tx_hash", paymentTxHash)
        .maybeSingle();
      if (existingPay) {
        throw new Error("This payment transaction was already used.");
      }

      const { data: profile } = await admin
        .from("profiles")
        .select("wallet_address")
        .eq("id", user.id)
        .maybeSingle();
      const walletAddress =
        user.app_metadata?.wallet_address || profile?.wallet_address;
      if (!walletAddress) throw new Error("Wallet address not found");

      const expected = calculateGenerationCharge(size);
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
        throw new Error(
          `Insufficient payment for ${expected.editions} editions.`
        );
      }

      const { error: payError } = await admin.from("generation_payments").insert({
        tx_hash: paymentTxHash,
        wallet_address: walletAddress,
        project_id: projectId,
        edition_count: expected.editions,
        amount_atomic: transfer.value.toString(),
        token_identifier: TOKEN_ID,
      });
      if (payError) {
        if (payError.code === "23505") {
          throw new Error("This payment transaction was already used.");
        }
        throw payError;
      }
    }

    const { data: job, error: jobError } = await admin
      .from("generation_jobs")
      .insert({
        project_id: projectId,
        edition_size: size,
        status: "queued",
        client_mode: true,
      })
      .select()
      .single();

    if (jobError) throw jobError;

    await admin
      .from("projects")
      .update({ status: "generating", edition_size: size })
      .eq("id", projectId);

    return new Response(JSON.stringify({ job }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
