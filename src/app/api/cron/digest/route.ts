import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { buildBooks, buildWorld } from "@/lib/data";
import { buildDigest, type DigestNote } from "@/lib/digest";
import type { Person } from "@/lib/model";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron calls this at 08:30 India time with CRON_SECRET. It needs the
// service key (to read everyone's alerts) and an SMTP mailbox to send from.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]);
  if (missing.length) return Response.json({ error: `Morning email is off: set ${missing.join(", ")} in Vercel.` }, { status: 503 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { world, error } = await buildWorld(db, "", false);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const { books } = await buildBooks(db, world);
  const { data: people } = await db.from("profiles").select("id, full_name, email, role, active").eq("active", true).eq("digest", true)
    .in("role", ["owner", "manager", "merchandiser", "qc", "accounts"]);
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data: notes } = await db.from("notifications").select("user_id, title, body, href, created_at").gte("created_at", since).order("created_at", { ascending: false });

  const mail = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
  const from = process.env.MAIL_FROM || `Sourcingo OS <${process.env.SMTP_USER}>`;
  const sent: string[] = [];
  const failed: string[] = [];
  for (const p of (people ?? []) as Person[]) {
    const mine = ((notes ?? []) as (DigestNote & { user_id: string })[]).filter((n) => n.user_id === p.id);
    const d = buildDigest({ ...world, meId: p.id, isOwner: p.role === "owner" }, p, books, mine);
    if (d.empty) continue;
    try {
      await mail.sendMail({ from, to: p.email, subject: d.subject, html: d.html, text: d.text });
      sent.push(p.email);
    } catch (e) {
      failed.push(`${p.email}: ${(e as Error).message}`);
    }
  }
  return Response.json({ sent: sent.length, failed });
}
