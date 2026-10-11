import ExcelJS from "npm:exceljs@4.4.0";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { readPosFree, type Sheet } from "./free-reader.ts";

// Reads buyer POs (PDF, Excel, CSV or a photo) and returns each PO found as plain data.
// With an AI key, Claude reads them; without one, the free reader fills in what it can find.

export type PoFile = { name: string; type: string; bytes: Uint8Array };
export type PoLine = { style: string; description: string | null; colour: string | null; sizes: string | null; qty: number; rate: number | null };
export type PoReading = {
  buyer_name: string | null;
  buyer_code: string | null;
  po_number: string | null;
  po_date: string | null;
  ship_date: string | null;
  lines: PoLine[];
  notes: string | null;
  doubts: string[];
};

const MODEL = "claude-sonnet-5-5";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE = 5 * 1024 * 1024;

const orNull = (type: string, description?: string) => ({ anyOf: [{ type }, { type: "null" }], ...(description ? { description } : {}) });

const SCHEMA = {
  type: "object",
  properties: {
    pos: {
      type: "array",
      description: "Every purchase order a BUYER has issued TO Sourcingo in these files. Empty when there is none.",
      items: {
        type: "object",
        properties: {
          buyer_name: orNull("string", "The buyer company that issued the PO, as printed."),
          buyer_code: orNull("string", "The matching code from the buyer list, only when the buyer clearly is one of them."),
          po_number: orNull("string", "The buyer's PO number exactly as printed."),
          po_date: orNull("string", "PO date as YYYY-MM-DD."),
          ship_date: orNull("string", "Delivery / ship / dispatch date as YYYY-MM-DD. The latest if there are several."),
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                style: { type: "string", description: "Style number or article code. Use the item name if there is no code." },
                description: orNull("string"),
                colour: orNull("string"),
                sizes: orNull("string", "Size breakup like 'S 50, M 50, L 50'."),
                qty: { type: "integer", description: "Total pieces for this style and colour." },
                rate: orNull("number", "Price per piece in rupees, before tax."),
              },
              required: ["style", "description", "colour", "sizes", "qty", "rate"],
              additionalProperties: false,
            },
          },
          notes: orNull("string", "Anything the merchandiser must know: packing, labels, penalties, payment terms."),
          doubts: { type: "array", items: { type: "string" }, description: "Anything unclear or unreadable that a person should check." },
        },
        required: ["buyer_name", "buyer_code", "po_number", "po_date", "ship_date", "lines", "notes", "doubts"],
        additionalProperties: false,
      },
    },
  },
  required: ["pos"],
  additionalProperties: false,
};

const PROMPT = `You read purchase orders for Sourcingo, a garment sourcing company in India.
Find every purchase order that a BUYER issued TO Sourcingo (Sourcingo is the supplier). Ignore:
- purchase orders Sourcingo issued to its own factories or vendors (Sourcingo is the buyer on those),
- invoices, debit notes, quotations, tech packs, onboarding papers and anything else that is not a buyer's PO.
Copy numbers exactly; never guess a quantity or price. If something is unreadable, leave it null and say so in doubts.
Dates are Indian (day before month) unless clearly otherwise. Combine sizes of the same style and colour into one line.`;

// Each sheet of an Excel file as rows of cell text.
async function excelRows(bytes: Uint8Array): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "object") {
          const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
          if (o.richText) return o.richText.map((t) => t.text).join("");
          return String(o.result ?? o.text ?? "");
        }
        return String(v);
      });
      if (cells.some((c) => c.trim())) rows.push(cells);
    });
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

async function excelText(bytes: Uint8Array): Promise<string> {
  const sheets = await excelRows(bytes);
  return sheets.map((s) => [`# Sheet: ${s.name}`, ...s.rows.map((r) => r.join(" | "))].join("\n")).join("\n").slice(0, 200_000);
}

const b64 = (bytes: Uint8Array) => encodeBase64(bytes);
const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

// Turns each file into something Claude can read. Files it can't read are listed so the reading says so.
async function contentFor(files: PoFile[]) {
  const blocks: unknown[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const e = ext(f.name);
    if (f.type === "application/pdf" || e === "pdf") {
      blocks.push({ type: "text", text: `File: ${f.name}` }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(f.bytes) } });
    } else if (IMAGE_TYPES.includes(f.type) && f.bytes.byteLength <= MAX_IMAGE) {
      blocks.push({ type: "text", text: `File: ${f.name}` }, { type: "image", source: { type: "base64", media_type: f.type, data: b64(f.bytes) } });
    } else if (e === "xlsx") {
      blocks.push({ type: "text", text: `File: ${f.name} (Excel, as text)\n${await excelText(f.bytes)}` });
    } else if (e === "csv" || f.type === "text/csv") {
      blocks.push({ type: "text", text: `File: ${f.name} (CSV)\n${new TextDecoder().decode(f.bytes).slice(0, 200_000)}` });
    } else {
      skipped.push(f.name);
    }
  }
  return { blocks, skipped };
}

export async function readPos(
  key: string | null,
  files: PoFile[],
  email: { from: string | null; subject: string | null; body: string | null } | null,
  buyers: { code: string; name: string | null }[],
): Promise<PoReading[]> {
  if (!key) return readPosFree(files, email, buyers, excelRows);
  if (Deno.env.get("PO_READER_MOCK") === "1") return mockReading(files);

  const { blocks, skipped } = await contentFor(files);
  if (!blocks.length) {
    throw new Error(skipped.length ? `Can't read ${skipped.join(", ")}. Send the PO as a PDF, an .xlsx file or a photo.` : "There is no file to read.");
  }
  const context = [
    `Buyers Sourcingo already has (code: name):\n${buyers.map((b) => `${b.code}: ${b.name ?? "(name not known)"}`).join("\n") || "none"}`,
    email ? `The files came by email.\nFrom: ${email.from ?? ""}\nSubject: ${email.subject ?? ""}\nMessage:\n${(email.body ?? "").slice(0, 4000)}` : "The files were added by the team.",
    skipped.length ? `These files could not be opened: ${skipped.join(", ")}.` : "",
  ].filter(Boolean).join("\n\n");

  const content = [...blocks, { type: "text", text: context }];
  return ask(key, content);
}

async function ask(key: string, content: unknown[]): Promise<PoReading[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: PROMPT,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`The AI could not read the files (${res.status}). ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { stop_reason?: string; content: { type: string; text?: string }[] };
  if (data.stop_reason === "max_tokens") throw new Error("These files are too long to read in one go. Split the PO into smaller files.");
  const answer = data.content.find((c) => c.type === "text")?.text;
  let parsed: { pos?: PoReading[] } | null = null;
  try {
    parsed = answer ? JSON.parse(answer) : null;
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed?.pos)) throw new Error("The AI gave no answer. Try reading again.");
  return parsed.pos.map(clean);
}

const isoDate = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const text = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);

function clean(p: PoReading): PoReading {
  return {
    buyer_name: text(p.buyer_name),
    buyer_code: text(p.buyer_code)?.toUpperCase() ?? null,
    po_number: text(p.po_number),
    po_date: isoDate(p.po_date),
    ship_date: isoDate(p.ship_date),
    lines: (Array.isArray(p.lines) ? p.lines : []).filter((l) => text(l?.style)).map((l) => ({
      style: text(l.style)!,
      description: text(l.description),
      colour: text(l.colour),
      sizes: text(l.sizes),
      qty: Number.isFinite(Number(l.qty)) ? Math.max(0, Math.round(Number(l.qty))) : 0,
      rate: l.rate == null || !Number.isFinite(Number(l.rate)) ? null : Number(l.rate),
    })),
    notes: text(p.notes),
    doubts: (Array.isArray(p.doubts) ? p.doubts : []).map(text).filter((d): d is string => !!d),
  };
}

// For local tests without an AI key: a file named "not-a-po..." holds no PO; any other file holds one PO named after it.
function mockReading(files: PoFile[]): PoReading[] {
  return files.filter((f) => !f.name.startsWith("not-a-po")).map((f) => ({
    buyer_name: null,
    buyer_code: "BYR-PRD",
    po_number: f.name.replace(/\.[^.]+$/, "").toUpperCase(),
    po_date: "2026-10-01",
    ship_date: "2026-12-15",
    lines: [
      { style: "MK-1", description: "Kurta", colour: "Blue", sizes: "S 40, M 60", qty: 100, rate: 450 },
      { style: "MK-2", description: null, colour: null, sizes: null, qty: 60, rate: null },
    ],
    notes: "Pack 10 per carton",
    doubts: ["Rate for MK-2 not printed"],
  }));
}
