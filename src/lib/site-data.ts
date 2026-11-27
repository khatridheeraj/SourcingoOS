import { createClient as createPlainClient } from "@supabase/supabase-js";

// A database client as a visitor: no cookies, so pages that use it can be cached, and a signed-in team member filling
// in the public form is treated like anyone else.
export const siteClient = () =>
  createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export type SiteFacts = { guarantee?: boolean; deposit_pct?: number; pay_days?: number; record?: boolean };
export async function siteFacts(): Promise<SiteFacts> {
  try {
    const { data } = await siteClient().rpc("site_facts");
    return (data ?? {}) as SiteFacts;
  } catch {
    return {};
  }
}
