// PO files live in the private "po-files" bucket at <company>/<incoming PO id>/<random>.<ext>.
export const PO_BUCKET = "po-files";
export const PO_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", csv: "text/csv",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const PO_MAX_BYTES = 25 * 1024 * 1024;
export type StoredFile = { path: string; name: string; type: string; size: number };
