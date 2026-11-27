import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { day, istDate } from "@/lib/format";
import { kitStats, MIN, type RecordCounts } from "@/lib/record";
import { SITE_STAGES, SITE_URL } from "@/lib/site";
import { SITE_PRODUCTS } from "@/lib/site-products";

// The sales kit as one A4 page to attach to an email or WhatsApp: our record, how an order runs, what we make and how
// to reach us. Built from the same counts as the record page, so the PDF can never say more than the database does.
// (A printed page, so it carries its own colours: the app's ink, muted grey and indigo accent.)
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.43, 0.47);
const LINE = rgb(0.89, 0.89, 0.91);
const ACCENT = rgb(0.31, 0.27, 0.9);
const SOFT = rgb(0.965, 0.965, 0.98);

const W = 595.28, H = 841.89, M = 44;
const dayOf = (ts: string) => day(istDate(ts));

// Standard PDF fonts only speak Latin-1; anything else becomes a plain stand-in rather than breaking the file.
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of safe(text).split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function para(page: PDFPage, text: string, x: number, y: number, o: { font: PDFFont; size: number; width: number; color?: ReturnType<typeof rgb>; lead?: number }) {
  const lead = o.lead ?? o.size * 1.4;
  for (const l of wrap(text, o.font, o.size, o.width)) {
    page.drawText(l, { x, y, size: o.size, font: o.font, color: o.color ?? INK });
    y -= lead;
  }
  return y;
}

const phoneOf = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p ?? "";
};

export async function recordPdf(c: RecordCounts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Sourcingo - our record");
  doc.setAuthor("Sourcingo");
  doc.setSubject("Garment sourcing from India: our record, counted from real orders");
  const page = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const inner = W - M * 2;

  // Brand line.
  let y = H - M;
  page.drawRectangle({ x: M, y: y - 18, width: 22, height: 22, color: ACCENT });
  page.drawText("S", { x: M + 6.6, y: y - 12, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Sourcingo", { x: M + 30, y: y - 12, size: 14, font: bold, color: INK });
  const asOf = `Our record · ${dayOf(c.as_of)}`;
  page.drawText(safe(asOf), { x: W - M - reg.widthOfTextAtSize(safe(asOf), 10), y: y - 11, size: 10, font: reg, color: MUTED });
  y -= 52;

  // Headline and promise.
  y = para(page, "Garments made in India, watched at every step.", M, y, { font: bold, size: 24, width: inner, lead: 29 });
  y -= 4;
  y = para(page, "Sourcingo is the one partner accountable for your order, from a costing on your exact sample to the shipment leaving Jaipur. Checked factories make it, our team checks every step photo before you see it, and our own inspectors pass it before it ships. The numbers below are counted from our order records, not typed in.", M, y, { font: reg, size: 10.5, width: inner, color: MUTED, lead: 15 });
  y -= 14;

  // The record: two columns of boxes.
  const stats = kitStats(c).slice(0, 6);
  const gap = 12, colW = (inner - gap) / 2, boxH = 70;
  stats.forEach((s, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * (colW + gap), top = y - row * (boxH + gap);
    page.drawRectangle({ x, y: top - boxH, width: colW, height: boxH, color: SOFT, borderColor: LINE, borderWidth: 0.8 });
    page.drawText(safe(s.value), { x: x + 14, y: top - 32, size: 24, font: bold, color: ACCENT });
    const vw = bold.widthOfTextAtSize(safe(s.value), 24);
    para(page, s.label, x + 14 + vw + 8, top - 25, { font: bold, size: 10, width: colW - vw - 36, lead: 12 });
    para(page, s.note, x + 14, top - 47, { font: reg, size: 8.5, width: colW - 28, color: MUTED, lead: 11 });
  });
  y -= Math.ceil(stats.length / 2) * (boxH + gap) + 10;

  // How an order runs.
  page.drawText("How an order runs", { x: M, y, size: 12.5, font: bold, color: INK });
  y -= 18;
  const sw = (inner - gap * 2) / 3, sh = 60;
  SITE_STAGES.forEach((s, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = M + col * (sw + gap), top = y - row * (sh + 6);
    page.drawText(`${String(i + 1).padStart(2, "0")}  ${safe(s.key).toUpperCase()}`, { x, y: top - 9, size: 7.5, font: bold, color: ACCENT });
    para(page, s.title, x, top - 23, { font: bold, size: 9.5, width: sw, lead: 12 });
    para(page, s.text, x, top - 36, { font: reg, size: 7.8, width: sw, color: MUTED, lead: 10 });
  });
  y -= 2 * (sh + 6) + 6;

  // What we make, and how to reach us.
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 20;
  const half = (inner - 24) / 2;
  page.drawText("What we make", { x: M, y, size: 12.5, font: bold, color: INK });
  page.drawText("Ask for a costing", { x: M + half + 24, y, size: 12.5, font: bold, color: INK });
  let ly = y - 17;
  for (const p of SITE_PRODUCTS) {
    page.drawText(safe(`·  ${p.name}`), { x: M, y: ly, size: 9.5, font: reg, color: INK });
    ly -= 13.5;
  }
  let ry = para(page, "Send a sample, tech pack or photos. A merchandiser replies with questions or a price per piece and a ready date.", M + half + 24, y - 17, { font: reg, size: 9.5, width: half, color: MUTED, lead: 13.5 });
  ry -= 6;
  const site = SITE_URL.replace(/^https?:\/\//, "");
  for (const [k, v] of [["Website", `${site}/costing`], ["Email", c.email ?? ""], ["Phone and WhatsApp", phoneOf(c.phone)]] as const) {
    if (!v) continue;
    page.drawText(safe(k), { x: M + half + 24, y: ry, size: 8, font: bold, color: MUTED });
    page.drawText(safe(v), { x: M + half + 24 + 92, y: ry, size: 9.5, font: reg, color: INK });
    ry -= 14;
  }

  // How the numbers were counted.
  para(page, `Counted on ${dayOf(c.as_of)} from Sourcingo's order, shipment, production-plan and inspection records. A rate is shown only once it rests on enough cases (${MIN.steps} dated steps, ${MIN.finals} final inspections, ${MIN.shipments} shipments). Factory names stay private; buyers follow their order with photos our team has checked.`, M, M, { font: reg, size: 7.5, width: inner, color: MUTED, lead: 10 });
  return doc.save();
}
