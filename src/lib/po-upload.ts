import { addOrderPoFiles } from "@/app/(app)/orders/actions";
import { PO_BUCKET, PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/po-files";
import { createClient } from "@/lib/supabase/client";

export const PO_ACCEPT = Object.keys(PO_FILE_TYPES).map((e) => `.${e}`).join(",");

// Why a picked file can't be a PO file, or "" when it can.
export function poFileProblem(f: File): string {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (!PO_FILE_TYPES[ext]) {
    return ext === "heic" || ext === "heif"
      ? `${f.name} is an iPhone HEIC photo. Share it as a JPG, or set the camera to "Most compatible".`
      : `${f.name} isn't a PDF, Excel, CSV or photo.`;
  }
  return f.size > PO_MAX_BYTES ? `${f.name} is over 25 MB.` : "";
}

// Uploads the buyer's PO files to the order's folder and keeps them on the order. Check them with poFileProblem first.
export async function uploadPoFiles(companyId: string, orderId: string, files: File[]): Promise<{ error?: string; count?: number }> {
  const supabase = createClient();
  const stored: StoredFile[] = [];
  for (const f of files) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const type = PO_FILE_TYPES[ext];
    const path = `${companyId}/${orderId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PO_BUCKET).upload(path, f, { contentType: type });
    if (error) return { error: `Couldn't upload ${f.name}: ${error.message}` };
    stored.push({ path, name: f.name, type, size: f.size });
  }
  const res = await addOrderPoFiles(orderId, stored);
  return res.error ? res : { count: stored.length };
}
