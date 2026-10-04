// What can be attached where. Shared by the browser uploader and the server.

export type FileCategory = "inquiry_image" | "tech_pack" | "cutting_program" | "style_photo" | "grn_photo" | "qc_report" | "sample_photo" | "qc_photo" | "other";
export type FileTarget = "inquiry" | "style" | "grn" | "sample" | "qc";

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  inquiry_image: "Reference image",
  tech_pack: "Tech pack",
  cutting_program: "Cutting program",
  style_photo: "Photo",
  grn_photo: "Goods photo",
  qc_report: "QC report",
  sample_photo: "Photo",
  qc_photo: "Defect photo",
  other: "Other",
};

export const CATEGORIES_FOR: Record<FileTarget, FileCategory[]> = {
  inquiry: ["inquiry_image", "other"],
  style: ["tech_pack", "cutting_program", "style_photo", "qc_report", "other"],
  grn: ["grn_photo", "qc_report", "other"],
  sample: ["sample_photo", "other"],
  qc: ["qc_photo", "qc_report", "other"],
};

export const TARGET_COLUMN = { inquiry: "inquiry_id", style: "style_id", grn: "grn_id", sample: "sample_id", qc: "qc_id" } as const;

export const MAX_BYTES = 25 * 1024 * 1024;

const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", csv: "text/csv", zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
};
export const ALLOWED_TYPES = new Set(Object.values(BY_EXT));
export const ACCEPT = Object.keys(BY_EXT).map((e) => `.${e}`).join(",") + ",image/*";

export const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

// Browsers sometimes leave the type blank (CSV, Excel on Windows); fall back to the extension.
export function typeOf(name: string, type: string) {
  if (ALLOWED_TYPES.has(type)) return type;
  return BY_EXT[extOf(name)] ?? type;
}

export const isImage = (mime: string) => mime.startsWith("image/");

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export type FileItem = {
  id: string; category: FileCategory; file_name: string; mime_type: string; size_bytes: number;
  created_at: string; by: string; mine: boolean; url: string | null;
};
