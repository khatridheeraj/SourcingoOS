import { briefHtml, briefText, buildBrief, type BriefData } from "@/lib/brief";

// The 9 am email: the Gmail script sends its mailbox's Google sign-in, the PO reader function checks it with Google
// and returns that person's brief data, and this answers with the email to send. The script mails it to itself.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { google_token?: unknown } | null;
  if (typeof body?.google_token !== "string" || !body.google_token) return Response.json({ error: "Send the mailbox's Google sign-in." }, { status: 400 });
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/po-inbox`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    body: JSON.stringify({ action: "brief", google_token: body.google_token }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as (BriefData & { error?: string }) | null;
  if (!res?.ok || !data || data.error) return Response.json({ error: data?.error ?? "The brief couldn't be made." }, { status: res?.status && res.status >= 400 ? res.status : 502 });
  const b = buildBrief(data);
  const app = new URL(request.url).origin;
  return Response.json({
    subject: `Sourcingo brief, ${b.title}: ${b.headline}`,
    html: briefHtml(b, data.company, app),
    text: briefText(b, data.company),
  });
}
