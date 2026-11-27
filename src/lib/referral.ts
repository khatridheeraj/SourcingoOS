import { SITE_URL } from "@/lib/site";

// Invite links. A buyer invites a brand to the website; a factory invites another factory to ask to join. The code
// rides along to the form (kept in the visitor's browser), so the team sees who sent them. It never shows its owner.
export const REF_KEY = "sourcingo-ref";
export const isRef = (v: string | null | undefined): v is string => !!v && /^[0-9a-f]{8}$/.test(v);
export const buyerInvite = (code: string) => `${SITE_URL}/?ref=${code}`;
export const factoryInvite = (code: string) => `${SITE_URL}/for-factories?ref=${code}#join`;
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
