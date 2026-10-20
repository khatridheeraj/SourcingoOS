// What files attached to team notes are, worked out from their stored paths. Safe to use on the server and in the browser.
export const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4" };
export const PHOTO_EXT = /^(jpe?g|png|webp|gif|heic|heif)$/;

// What a stored attachment is, from its extension, for showing it.
export function attachKind(path: string): "photo" | "video" | "file" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return PHOTO_EXT.test(ext) ? "photo" : VIDEO_TYPES[ext] ? "video" : "file";
}

// The original file name kept in an attachment's path, <folder>/<uuid>__<name>.
export function attachName(path: string): string {
  const file = path.split("/").pop() ?? path;
  const i = file.indexOf("__");
  return i < 0 ? file : file.slice(i + 2);
}
