import { NextResponse } from "next/server";
import { getMe, canEditOrders } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Shared by the Markers routes: MarkerPilot (public/markerpilot/index.html) calls them from the page.

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

// The signed-in person's database client, or an answer saying why they can't use Markers.
export async function markersClient() {
  const me = await getMe();
  if (!me) return { error: json({ error: "signed_out", message: "Sign in again, then retry." }, 401) };
  if (!canEditOrders(me.role)) return { error: json({ error: "forbidden", message: "Markers is for the orders team." }, 403) };
  return { supabase: await createClient(), me };
}

// Asks the marker reader (a Supabase function) to start or check a reading, as the signed-in person.
export async function askMarkerReader(supabase: Awaited<ReturnType<typeof createClient>>, action: "start" | "check", id: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Sign in again, then retry." };
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/marker-reader`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? {} : { error: data.error ?? "The photo reader didn't answer. Try again in a minute." };
  } catch {
    return { error: "The photo reader didn't answer. Try again in a minute." };
  }
}
