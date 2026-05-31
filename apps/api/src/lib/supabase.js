const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

// Load env from apps/api/.env first, then fall back to repo root .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "\n[config] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Create apps/api/.env (copy from apps/api/.env.example) with:\n" +
      "  SUPABASE_URL=https://<project>.supabase.co\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=<service-role-key>\n"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabase };
