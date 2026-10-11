import { createClient } from "@supabase/supabase-js";

// The server's own key, for work no signed-in person does: taking emails from the mailbox script and saving the AI's reading.
// Never import this into anything that runs in the browser.
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("The server key (SUPABASE_SECRET_KEY) is not set up yet.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
