import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function loginWithNativeAuth(accessToken) {
  const { data, error } = await supabase.functions.invoke("mvx-auth", {
    body: { accessToken },
  });

  if (error) throw error;
  if (data.error) throw new Error(data.error);

  if (data.session) {
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }

  return data;
}
