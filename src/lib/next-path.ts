// Where to land after signing in: the page someone opened while signed out (a link from an email or a chat),
// kept in a short-lived cookie between asking for the sign-in link and tapping it. Only paths inside the app count.
export const NEXT_COOKIE = "sg_next";

export function safeNext(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/today";
  if (v === "/" || v.startsWith("/login") || v.startsWith("/auth")) return "/today";
  return v;
}
