import { headers } from "next/headers";

// The app's address as the person reached it, for links put into messages (the live site, or a preview).
export async function appOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "sourcingo-os.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
