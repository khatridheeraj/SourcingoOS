import { createClient } from "@/lib/supabase/client";

import { PHOTO_BUCKET } from "@/lib/storage";

// Shrinks a phone photo to at most 1600 px on its longest side as a JPEG, so uploads stay quick on mobile data.
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.82));
}

// Uploads photos into the given folder and returns their storage paths.
export async function uploadPhotos(folder: string, files: File[]): Promise<string[]> {
  const supabase = createClient();
  const paths: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not a photo.`);
    const path = `${folder}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, await shrink(file), { contentType: "image/jpeg" });
    if (error) throw new Error(`Couldn't upload ${file.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

const REPORT_TYPES: Record<string, string> = {
  pdf: "application/pdf", csv: "text/csv", xls: "application/vnd.ms-excel", doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const REPORT_ACCEPT = Object.keys(REPORT_TYPES).map((e) => `.${e}`).join(",");

// Uploads report files (PDF, Excel, Word, CSV) as they are, and returns their storage paths with the original names.
export async function uploadReports(folder: string, files: File[]): Promise<{ path: string; file_name: string }[]> {
  const supabase = createClient();
  const out: { path: string; file_name: string }[] = [];
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = REPORT_TYPES[ext];
    if (!type) throw new Error(`${file.name} isn't a PDF, Excel, Word or CSV file.`);
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is over 10 MB.`);
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: type });
    if (error) throw new Error(`Couldn't upload ${file.name}: ${error.message}`);
    out.push({ path, file_name: file.name });
  }
  return out;
}
