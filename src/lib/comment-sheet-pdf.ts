// The sample comment sheet as a PDF (pdf-lib, in the browser): Sourcingo's compact header (logo and orange rule,
// not the full letterhead), the sample details, the result badge, the numbered points, next step, signatures,
// and a photo-evidence page when photos were added. A4, Helvetica.
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { isDeviation, stageOf, verdictOf, type SheetData } from "./comment-sheet.ts";
import { day } from "./format.ts";

export type SheetPhoto = { jpeg: Uint8Array; caption: string };

const A4 = { w: 595.28, h: 841.89 };
const M = 51; // 18 mm
const INK = rgb(0.137, 0.122, 0.125);
const MUTE = rgb(0.435, 0.424, 0.427);
const FAINT = rgb(0.66, 0.64, 0.63);
const ORANGE = rgb(0.722, 0.482, 0.239);
const ORANGE_SOFT = rgb(0.969, 0.937, 0.902);
const RULE = rgb(0.925, 0.91, 0.89);
const RED = rgb(0.702, 0.149, 0.118);
const BADGE: Record<string, ReturnType<typeof rgb>> = { not_approved: RED, approved_with_comments: rgb(0.718, 0.475, 0.122), approved: rgb(0.18, 0.49, 0.31) };

// Helvetica knows WinAnsi only: eighths become fractions, anything else it can't draw becomes a plain mark.
function safe(font: PDFFont, s: string) {
  const t = s.replace(/⅛/g, "1/8").replace(/⅜/g, "3/8").replace(/⅝/g, "5/8").replace(/⅞/g, "7/8").replace(/→/g, "->").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const set = new Set(font.getCharacterSet());
  return Array.from(t).map((c) => (set.has(c.codePointAt(0)!) ? c : "?")).join("");
}
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

type Ctx = { doc: PDFDocument; font: PDFFont; bold: PDFFont; italic: PDFFont; logo: PDFImage | null; d: SheetData; orderNo: string; pages: PDFPage[] };

function text(c: Ctx, page: PDFPage, s: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) {
  const font = o.font ?? c.font; const size = o.size ?? 9.5; const t = safe(font, s);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: o.right ? x - w : x, y, size, font, color: o.color ?? INK });
  return w;
}
function hline(page: PDFPage, x1: number, x2: number, y: number, color = RULE, w = 0.6) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: w, color });
}

function newPage(c: Ctx, first: boolean): PDFPage {
  const page = c.doc.addPage([A4.w, A4.h]);
  c.pages.push(page);
  const top = A4.h - 40;
  if (first) {
    if (c.logo) { const h = 48; page.drawImage(c.logo, { x: M, y: top - h, width: h * (c.logo.width / c.logo.height), height: h }); }
    text(c, page, "Sample Comment Sheet", A4.w - M, top - 28, { size: 17, font: c.bold, right: true });
    text(c, page, "GARMENT INSPECTION  ·  POINTS FOR CORRECTION", A4.w - M, top - 42, { size: 7.3, color: MUTE, right: true });
    hline(page, M, A4.w - M, top - 56, ORANGE, 1.7);
  } else {
    if (c.logo) { const h = 26; page.drawImage(c.logo, { x: M, y: top - h, width: h * (c.logo.width / c.logo.height), height: h }); }
    text(c, page, `Sample Comment Sheet  ·  ${c.d.refNo}`, A4.w - M, top - 18, { size: 9, font: c.bold, right: true });
    hline(page, M, A4.w - M, top - 34, ORANGE, 1.7);
  }
  return page;
}
function footers(c: Ctx) {
  const n = c.pages.length;
  c.pages.forEach((page, i) => {
    hline(page, M, A4.w - M, 46, ORANGE, 1.2);
    text(c, page, "Sourcingo Pvt Ltd  ·  Plot No. 19, Maruti Colony, near Sanganer Airport, Jaipur 302029", M, 36, { size: 6.8, color: MUTE });
    text(c, page, n > 1 ? `Page ${i + 1} of ${n}  ·  sourcingo.in` : "sourcingo.in  ·  +91 96024 45110", A4.w - M, 36, { size: 6.8, color: MUTE, right: true });
  });
}

export async function renderCommentSheet(d: SheetData, orderNo: string, logoPng: Uint8Array | null, photos: SheetPhoto[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Sample Comment Sheet ${d.refNo}`);
  doc.setAuthor("Sourcingo Pvt Ltd");
  const c: Ctx = {
    doc, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    logo: logoPng ? await doc.embedPng(logoPng) : null, d, orderNo, pages: [],
  };
  const W = A4.w - 2 * M;
  let page = newPage(c, true);
  let y = A4.h - 40 - 56 - 16;

  // Ref and date.
  text(c, page, "Ref. ", M, y, { size: 8.3, color: MUTE });
  text(c, page, d.refNo, M + 20, y, { size: 8.3, font: c.bold });
  const dw = text(c, page, day(d.date), A4.w - M, y, { size: 8.3, font: c.bold, right: true });
  text(c, page, "Date ", A4.w - M - dw - 3, y, { size: 8.3, color: MUTE, right: true });
  y -= 22;

  // Details grid: three columns, two rows.
  const meta: [string, string, string][] = [
    ["ORDER / BUYER", [orderNo, d.buyer].filter(Boolean).join("  ·  "), "Order"], ["STYLE", d.style, "Style"], ["FACTORY", d.factory, "Factory"],
    ["SAMPLE STAGE", stageOf(d.stage)?.label ?? d.stage, "Stage"], ["SIZE", d.size, "Size"], ["CHECKED BY", d.checkedBy, "Checked by"],
  ];
  const cw = (W - 24) / 3;
  meta.forEach(([k, v, ph], i) => {
    const x = M + (i % 3) * (cw + 12); const yy = y - Math.floor(i / 3) * 34;
    text(c, page, k, x, yy, { size: 6.6, color: MUTE });
    const has = !!v.trim();
    const t = safe(has ? c.font : c.italic, has ? v : ph);
    const fit = wrap(has ? c.font : c.italic, 8.8, t, cw)[0] ?? "";
    text(c, page, fit, x, yy - 12, { size: 8.8, font: has ? c.font : c.italic, color: has ? INK : FAINT });
    hline(page, x, x + cw, yy - 18, RULE, 0.5);
  });
  y -= 34 * 2 + 8;

  // Result badge and summary.
  const v = verdictOf(d.verdict)!;
  const bw = c.bold.widthOfTextAtSize(v.badge, 9.5) + 28;
  page.drawRectangle({ x: M, y: y - 8, width: bw, height: 23, color: BADGE[d.verdict] ?? RED, borderWidth: 0 });
  page.drawText(v.badge, { x: M + 14, y: y - 1, size: 9.5, font: c.bold, color: rgb(1, 1, 1) });
  const sumLines = wrap(c.font, 9.2, safe(c.font, d.summary), W - bw - 14);
  sumLines.forEach((l, i) => page.drawText(l, { x: M + bw + 12, y: y + 6 - 4 - i * 12.5 - (sumLines.length === 1 ? 2 : 0), size: 9.2, font: c.font, color: INK }));
  y -= Math.max(30, sumLines.length * 12.5 + 14);

  // Points table.
  const cols = { n: M, area: M + 22, obs: M + 22 + 108, fix: M + W - W * 0.34 };
  const widths = { area: 100, obs: cols.fix - cols.obs - 10, fix: W * 0.34 - 4 };
  const header = (pg: PDFPage, yy: number) => {
    pg.drawRectangle({ x: M, y: yy - 6, width: W, height: 20, color: ORANGE_SOFT });
    hline(pg, M, A4.w - M, yy - 6, ORANGE, 1.1);
    [["#", cols.n], ["AREA", cols.area], ["OBSERVATION", cols.obs], ["CORRECTION REQUIRED", cols.fix]].forEach(([t, x]) => text(c, pg, t as string, (x as number) + 6, yy, { size: 7, font: c.bold }));
    return yy - 22;
  };
  y = header(page, y);
  const LEAD = 12.3;
  d.rows.forEach((r, i) => {
    const a = wrap(c.bold, 8.8, safe(c.bold, r.area), widths.area);
    const o = wrap(c.font, 8.8, safe(c.font, r.observation), widths.obs);
    const f = wrap(c.font, 8.8, safe(c.font, r.correction), widths.fix);
    const h = Math.max(a.length, o.length, f.length) * LEAD + 10;
    if (y - h < 70) { page = newPage(c, false); y = A4.h - 40 - 34 - 20; y = header(page, y); }
    text(c, page, String(i + 1), cols.n + 6, y, { size: 8.8, font: c.bold, color: ORANGE });
    a.forEach((l, k) => page.drawText(l, { x: cols.area + 6, y: y - k * LEAD, size: 8.8, font: c.bold, color: INK }));
    o.forEach((l, k) => page.drawText(l, { x: cols.obs + 6, y: y - k * LEAD, size: 8.8, font: c.font, color: isDeviation(r.observation) ? RED : INK }));
    f.forEach((l, k) => page.drawText(l, { x: cols.fix + 6, y: y - k * LEAD, size: 8.8, font: c.font, color: INK }));
    hline(page, M, A4.w - M, y - h + 10 - 4, RULE, 0.5);
    y -= h;
  });
  y -= 10;

  // Next step, signatures, disclaimer (kept together).
  const nextLines = wrap(c.font, 9.2, safe(c.font, d.nextStep), W - 70);
  const tail = nextLines.length * 12.5 + 16 + 46 + 24;
  if (y - tail < 60) { page = newPage(c, false); y = A4.h - 40 - 34 - 24; }
  page.drawRectangle({ x: M, y: y - nextLines.length * 12.5 - 2, width: 2.5, height: nextLines.length * 12.5 + 10, color: ORANGE });
  text(c, page, "Next step:", M + 11, y, { size: 9.2, font: c.bold });
  nextLines.forEach((l, i) => page.drawText(l, { x: M + 11 + 52, y: y - i * 12.5, size: 9.2, font: c.font, color: INK }));
  y -= nextLines.length * 12.5 + 40;
  const half = (W - 40) / 2;
  hline(page, M, M + half, y, INK, 0.8); hline(page, M + half + 40, A4.w - M, y, INK, 0.8);
  text(c, page, d.checkedBy.split(",")[0].trim(), M, y - 12, { size: 8, font: c.bold });
  text(c, page, "Quality, Sourcingo", M, y - 23, { size: 7.6, color: MUTE });
  text(c, page, "Factory representative", M + half + 40, y - 23, { size: 7.6, color: MUTE });
  y -= 44;
  text(c, page, "Comments reflect the sample as inspected on the date above and do not constitute bulk approval.", M, y, { size: 6.8, color: MUTE });

  // Photo evidence: two per row, captions under each.
  if (photos.length) {
    page = newPage(c, false); y = A4.h - 40 - 34 - 26;
    text(c, page, "Photo evidence", M, y, { size: 11, font: c.bold }); y -= 18;
    const pw = (W - 16) / 2; const ph = pw * 0.75;
    for (const [i, p] of photos.entries()) {
      const col = i % 2; const x = M + col * (pw + 16);
      if (col === 0 && y - ph - 30 < 60) { page = newPage(c, false); y = A4.h - 40 - 34 - 26; }
      let img: PDFImage;
      try { img = await doc.embedJpg(p.jpeg); } catch { continue; }
      const s = Math.min(pw / img.width, ph / img.height);
      const iw = img.width * s; const ih = img.height * s;
      page.drawRectangle({ x, y: y - ph, width: pw, height: ph, color: rgb(0.975, 0.97, 0.965) });
      page.drawImage(img, { x: x + (pw - iw) / 2, y: y - ph + (ph - ih) / 2, width: iw, height: ih });
      const cap = wrap(c.font, 8, safe(c.font, `Fig. ${i + 1} — ${p.caption || "Photo"}`), pw);
      cap.slice(0, 2).forEach((l, k) => page.drawText(l, { x, y: y - ph - 12 - k * 10.5, size: 8, font: c.font, color: MUTE }));
      if (col === 1 || i === photos.length - 1) y -= ph + 40;
    }
  }

  footers(c);
  return doc.save();
}
