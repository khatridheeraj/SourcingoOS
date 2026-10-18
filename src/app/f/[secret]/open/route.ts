import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE } from "@/app/factory/i18n";
import { createClient } from "@/lib/supabase/server";

// Signs this phone in as the factory behind the link: the link's secret is that login's password.
async function open(request: NextRequest, ctx: RouteContext<"/f/[secret]/open">) {
  const { secret } = await ctx.params;
  const { origin, searchParams } = request.nextUrl;
  const back = new URL(`/f/${encodeURIComponent(secret)}`, origin);
  const supabase = await createClient();
  const { data } = await supabase.rpc("factory_link_login", { p_secret: secret });
  const email = (data as { email?: string } | null)?.email;
  if (!email) return NextResponse.redirect(back, 303);
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email, password: secret });
  if (error) {
    back.searchParams.set("failed", "1");
    return NextResponse.redirect(back, 303);
  }
  const res = NextResponse.redirect(new URL("/factory", origin), 303);
  const lang = searchParams.get("lang");
  if (lang === "hi" || lang === "en") res.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  return res;
}

export const GET = open;
export const POST = open;
