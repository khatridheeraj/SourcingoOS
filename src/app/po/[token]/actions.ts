"use server";

import { revalidatePath } from "next/cache";
import { poByToken } from "./data";

// The factory accepts its PO on the link. No sign-in: the link's token is the key.
export async function acceptPo(token: string, name: string): Promise<{ error?: string }> {
  const r = await poByToken("po_accept", token, name.trim());
  if (r.error) return { error: r.error };
  revalidatePath(`/po/${token}`);
  return {};
}
