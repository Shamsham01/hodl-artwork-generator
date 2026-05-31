import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { NativeAuthServer } from "https://esm.sh/@multiversx/sdk-native-auth-server@1.0.18";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("MVX_ALLOWED_ORIGINS") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const MVX_API_MAP: Record<string, string> = {
  mainnet: Deno.env.get("MVX_API_MAINNET") || "https://api.multiversx.com",
  testnet:
    Deno.env.get("MVX_API_TESTNET") || "https://testnet-api.multiversx.com",
  devnet:
    Deno.env.get("MVX_API_DEVNET") || "https://devnet-api.multiversx.com",
};

function acceptedOrigins(): string[] {
  const raw = Deno.env.get("MVX_ALLOWED_ORIGINS") || "http://localhost:5173";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

// Validate the Native Auth token using the official server library.
// Returns the wallet address on success, or throws with a reason.
async function validateNativeAuth(accessToken: string): Promise<string> {
  const network = Deno.env.get("MVX_ENV") || "devnet";
  const apiUrl = MVX_API_MAP[network] || MVX_API_MAP.devnet;

  const server = new NativeAuthServer({
    apiUrl,
    acceptedOrigins: acceptedOrigins(),
    maxExpirySeconds: 86400,
    isOriginAccepted: (origin: string) => {
      const accepted = acceptedOrigins();
      return (
        accepted.includes(origin) ||
        accepted.some((o) => origin.startsWith(o))
      );
    },
  });

  const result = await server.validate(accessToken);
  if (!result?.address) {
    throw new Error("Token validated but no address returned");
  }
  return result.address;
}

function walletEmail(walletAddress: string): string {
  return `${walletAddress.toLowerCase()}@wallet.basturds.app`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { accessToken } = await req.json();
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Missing accessToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let walletAddress: string;
    try {
      walletAddress = await validateNativeAuth(accessToken);
    } catch (validationErr) {
      const reason =
        validationErr instanceof Error
          ? validationErr.message
          : "Invalid native auth token";
      return new Response(
        JSON.stringify({ error: "Invalid native auth token", reason }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const email = walletEmail(walletAddress);
    let userId: string;

    const { data: listData } = await supabase.auth.admin.listUsers();
    const existing = listData?.users?.find(
      (u) => u.app_metadata?.wallet_address === walletAddress
    );

    if (existing) {
      userId = existing.id;
    } else {
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { data: newUser, error: createError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { wallet_address: walletAddress },
        });
      if (createError || !newUser.user) {
        throw createError || new Error("Failed to create user");
      }
      userId = newUser.user.id;
    }

    await supabase.from("profiles").upsert(
      {
        id: userId,
        wallet_address: walletAddress,
        display_name:
          walletAddress.slice(0, 8) + "..." + walletAddress.slice(-4),
      },
      { onConflict: "id" }
    );

    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkError || !linkData?.properties?.hashed_token) {
      throw linkError || new Error("Failed to generate session link");
    }

    const { data: sessionData, error: verifyError } =
      await supabase.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: "email",
      });

    if (verifyError || !sessionData.session) {
      throw verifyError || new Error("Failed to create session");
    }

    return new Response(
      JSON.stringify({
        session: sessionData.session,
        user: sessionData.user,
        wallet_address: walletAddress,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
