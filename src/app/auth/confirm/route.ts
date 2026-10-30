import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";

// Landing point for the email sign-in link.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("missing token") };

  // A link tapped twice, or opened first by the mail app's link checker, is spent; if this browser is already
  // signed in, that's no reason to show "expired".
  const signedIn = !error || !!(await supabase.auth.getClaims()).data?.claims;
  const res = NextResponse.redirect(new URL(signedIn ? safeNext(request.cookies.get(NEXT_COOKIE)?.value) : "/login?error=link", origin));
  if (signedIn) res.cookies.delete(NEXT_COOKIE);
  return res;
}
