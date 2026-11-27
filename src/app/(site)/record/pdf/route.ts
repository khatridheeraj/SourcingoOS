import { loadRecord } from "@/lib/record-data";
import { recordPdf } from "@/lib/record-pdf";
import { createClient } from "@/lib/supabase/server";

// Our record as an A4 PDF. The team can always download it to send a lead; visitors only once the owner has switched
// the record on for the website.
export async function GET() {
  const record = await loadRecord(await createClient());
  if (!record) return new Response("Not found", { status: 404 });
  const bytes = await recordPdf(record);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Sourcingo-record-${day}.pdf"`, "cache-control": "private, no-store" },
  });
}
