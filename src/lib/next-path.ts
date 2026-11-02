// Where to land after signing in: the page someone opened while signed out (a link from an email or a chat),
// kept in a short-lived cookie between asking for the sign-in link and tapping it. Only paths inside the app count.
export const NEXT_COOKIE = "sg_next";

// Read the way a browser reads it: the URL parser drops tabs and line breaks and turns "\" into "/", so
// "/<tab>/evil.com" is really "//evil.com". Whatever doesn't stay on this site goes to /today.
const HERE = "https://app.invalid";

export function safeNext(v: string | null | undefined): string {
  if (!v || !v.startsWith("/")) return "/today";
  let u: URL;
  try { u = new URL(v, HERE); } catch { return "/today"; }
  if (u.origin !== HERE) return "/today";
  const path = u.pathname + u.search + u.hash;
  if (path === "/" || path.startsWith("/login") || path.startsWith("/auth")) return "/today";
  return path;
}
