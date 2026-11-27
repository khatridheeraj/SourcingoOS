"use server";

import { siteClient } from "@/lib/site-data";

export type SiteFormState = { ok?: boolean; no?: string; error?: string; values?: Record<string, string> };

const read = (fd: FormData) => {
  const v: Record<string, string> = {};
  for (const [k, x] of fd.entries()) if (typeof x === "string" && !k.startsWith("$")) v[k] = x;
  return v;
};

const say = (m: string | undefined) =>
  !m ? "Something went wrong. Please try again." : /fetch|network|ECONN|timeout/i.test(m) ? "We couldn't send that just now. Please check your connection and try again." : m;

// A costing request from the website. It becomes an inquiry on the team's Inquiries page, due for a reply today.
export async function askCosting(_: SiteFormState, fd: FormData): Promise<SiteFormState> {
  const v = read(fd);
  // A filled-in hidden field means a bot: say thanks and keep nothing.
  if (v.website) return { ok: true, no: "" };
  const { data, error } = await siteClient().rpc("site_ask_costing", { p: v });
  if (error) return { error: say(error.message), values: v };
  return { ok: true, no: String(data ?? "") };
}

// A factory asking to work with Sourcingo. It waits on the team's Factories page.
export async function joinAsFactory(_: SiteFormState, fd: FormData): Promise<SiteFormState> {
  const v = read(fd);
  if (v.website) return { ok: true };
  const { error } = await siteClient().rpc("site_join_factory", { p: v });
  if (error) return { error: say(error.message), values: v };
  return { ok: true };
}
