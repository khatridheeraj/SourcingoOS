"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { deleteFile } from "@/app/file-actions";
import { useFeedback } from "@/components/feedback";
import { ACCEPT, ALLOWED_TYPES, CATEGORY_LABEL, extOf, type FileCategory, type FileItem, type FileTarget, fmtBytes, isImage, MAX_BYTES, TARGET_COLUMN, typeOf } from "@/lib/file-kinds";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

// Phone photos are shrunk before upload so they go up fast on factory networks.
const MAX_SIDE = 2400;
const SHRINK_OVER = 1.5 * 1024 * 1024;

async function prepare(file: File): Promise<{ blob: Blob; name: string; type: string } | { error: string }> {
  let type = typeOf(file.name, file.type);
  let name = file.name;
  const photo = file.type.startsWith("image/") && file.type !== "image/gif";
  if (photo && (file.size > SHRINK_OVER || !ALLOWED_TYPES.has(type))) {
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (blob && (blob.size < file.size || !ALLOWED_TYPES.has(type))) {
        type = "image/jpeg";
        name = name.replace(/\.[^.]+$/, "") + ".jpg";
        return { blob, name, type };
      }
    } catch {
      if (!ALLOWED_TYPES.has(type)) return { error: `${file.name}: this photo format can't be read here. Save it as JPG or PNG and try again.` };
    }
  }
  if (!ALLOWED_TYPES.has(type)) return { error: `${file.name}: use PDF, Excel, Word, CSV, ZIP or a photo.` };
  if (file.size > MAX_BYTES) return { error: `${file.name} is ${fmtBytes(file.size)}. The limit is 25 MB.` };
  return { blob: file, name, type };
}

const safe = (name: string) => name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(-80) || "file";

export function Attachments({ target, id, files, upload = [], canDeleteAll = false, beforeUpload, title = "Files", hint, empty }: {
  target: FileTarget; id: string; files: FileItem[]; upload?: FileCategory[]; canDeleteAll?: boolean;
  beforeUpload?: () => Promise<boolean>; title?: string; hint?: string; empty?: string;
}) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [cat, setCat] = useState<FileCategory>(upload[0] ?? "other");
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const send = async (list: File[]) => {
    if (!list.length || busy) return;
    if (beforeUpload && !(await beforeUpload())) { toast("Save the order first, then add files.", "bad"); return; }
    const supabase = createClient();
    let done = 0;
    const errors: string[] = [];
    for (const file of list) {
      setBusy(list.length > 1 ? `Uploading ${done + 1} of ${list.length}…` : `Uploading ${file.name}…`);
      const p = await prepare(file);
      if ("error" in p) { errors.push(p.error); continue; }
      const path = `${target}/${id}/${crypto.randomUUID().slice(0, 8)}/${safe(p.name)}`;
      const { error: re } = await supabase.from("files").insert({
        category: cat, [TARGET_COLUMN[target]]: id, storage_path: path, file_name: p.name, mime_type: p.type, size_bytes: p.blob.size,
      });
      if (re) { errors.push(`${file.name}: ${re.message.includes("row-level security") ? "you can't add this kind of file here." : re.message}`); continue; }
      const { error: ue } = await supabase.storage.from("files").upload(path, p.blob, { contentType: p.type, upsert: false });
      if (ue) {
        await supabase.from("files").delete().eq("storage_path", path);
        errors.push(`${file.name}: ${ue.message}`);
        continue;
      }
      done++;
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    if (done) toast(done === 1 ? `Added ${CATEGORY_LABEL[cat].toLowerCase()}` : `Added ${done} files`);
    if (errors.length) toast(errors.join(" "), "bad");
    router.refresh();
  };

  const remove = async (f: FileItem) => {
    if (!(await confirm(`Delete ${f.file_name}? This can't be undone.`, "Delete", true))) return;
    setBusy("Deleting…");
    const r = await deleteFile(f.id);
    setBusy(null);
    toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
    router.refresh();
  };

  return (
    <div
      className={`files ${over ? "over" : ""}`}
      onDragOver={upload.length ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={upload.length ? (e) => { e.preventDefault(); setOver(false); void send([...e.dataTransfer.files]); } : undefined}
    >
      <div className="row">
        <span className="sub" style={{ flex: 1 }}>{title}{files.length > 0 && ` · ${files.length}`}</span>
        {upload.length > 0 && (
          <>
            {upload.length > 1 && (
              <select className="inp" style={{ width: "auto" }} value={cat} aria-label="Kind of file" onChange={(e) => setCat(e.target.value as FileCategory)}>
                {upload.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            )}
            <button type="button" className="btn sm" disabled={!!busy} onClick={() => input.current?.click()}>
              {busy ?? `+ Add ${upload.length === 1 ? CATEGORY_LABEL[cat].toLowerCase() : "file"}`}
            </button>
            <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => void send([...(e.target.files ?? [])])} />
          </>
        )}
      </div>
      {files.length ? (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id} className="file">
              <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="thumb" aria-label={`Open ${f.file_name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage links, not static assets */}
                {isImage(f.mime_type) && f.url ? <img src={f.url} alt="" loading="lazy" /> : <span>{extOf(f.file_name).slice(0, 4) || "file"}</span>}
              </a>
              <div className="info">
                <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="name">{f.file_name}</a>
                <small>{CATEGORY_LABEL[f.category]} · {fmtBytes(f.size_bytes)} · {f.by} · {fmtDateTime(f.created_at)}</small>
              </div>
              {(canDeleteAll || f.mine) && upload.length > 0 && (
                <button type="button" className="btn icon danger" disabled={!!busy} onClick={() => remove(f)} aria-label={`Delete ${f.file_name}`}>×</button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">{empty ?? (upload.length ? "Nothing yet. Drop files here or use the button." : "Nothing yet.")}</p>
      )}
      {hint && upload.length > 0 && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
