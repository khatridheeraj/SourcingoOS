import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Signs this phone in as the buyer behind the link: the link's secret is that login's password.
async function open(request: NextRequest, ctx: RouteContext<"/s/[secret]/open">) {
  const { secret } = await ctx.params;
  const { origin } = request.nextUrl;
  const back = new URL(`/s/${encodeURIComponent(secret)}`, origin);
  const supabase = await createClient();
  const { data } = await supabase.rpc("buyer_link_login", { p_secret: secret });
  const email = (data as { email?: string } | null)?.email;
  if (!email) return NextResponse.redirect(back, 303);
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email, password: secret });
  if (error) {
    back.searchParams.set("failed", "1");
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.redirect(new URL("/buyer", origin), 303);
}

export const GET = open;
export const POST = open;
