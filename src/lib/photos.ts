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
