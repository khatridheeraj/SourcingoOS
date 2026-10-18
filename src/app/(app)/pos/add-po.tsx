"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PO_FILE_TYPES, PO_MAX_BYTES, PO_BUCKET, type StoredFile } from "@/lib/po-files";
import { createClient } from "@/lib/supabase/client";
import { addPoFiles } from "./actions";

const ACCEPT = Object.keys(PO_FILE_TYPES).map((e) => `.${e}`).join(",");

// Add a PO that came another way, such as a WhatsApp group: pick the PO's file (or photos of its pages) and it is read into a draft.
export function AddPo({ companyId }: { companyId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function upload(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setError("");
    setDone(false);
    // The same file can be picked again after a problem.
    const fail = (message: string) => {
      if (input.current) input.current.value = "";
      setError(message);
    };
    // Every file is checked before any is uploaded, so one wrong file doesn't leave the others half sent.
    const picked: { f: File; ext: string; type: string }[] = [];
    for (const f of files) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const type = PO_FILE_TYPES[ext];
      if (!type) {
        return fail(ext === "heic" || ext === "heif"
          ? `${f.name} is an iPhone HEIC photo, which can't be read. Share it as a JPG, or set the camera to "Most compatible".`
          : `${f.name} isn't a PDF, Excel, CSV or photo.`);
      }
      if (f.size > PO_MAX_BYTES) return fail(`${f.name} is over 25 MB.`);
      picked.push({ f, ext, type });
    }
    start(async () => {
      const id = crypto.randomUUID();
      const supabase = createClient();
      const stored: StoredFile[] = [];
      for (const { f, ext, type } of picked) {
        const path = `${companyId}/${id}/${crypto.randomUUID()}.${ext}`;
        const { error: up } = await supabase.storage.from(PO_BUCKET).upload(path, f, { contentType: type });
        if (up) {
          // The files already sent are taken back, so nothing is left half added.
          if (stored.length) await supabase.storage.from(PO_BUCKET).remove(stored.map((s) => s.path));
          return fail(`Couldn't upload ${f.name}: ${up.message}`);
        }
        stored.push({ path, name: f.name, type, size: f.size });
      }
      const res = await addPoFiles(id, stored);
      if (res.error) return fail(res.error);
      if (input.current) input.current.value = "";
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className={`btn primary ${pending ? "opacity-60" : ""}`} title="For POs that came on WhatsApp or by hand: the PO file, or photos of all its pages together">
        {pending ? "Uploading…" : "Add PO from a file"}
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" disabled={pending}
          onChange={(e) => upload(e.target.files)} aria-label="PO file" />
      </label>
      {done && !error && <span className="text-[12.5px] font-semibold text-ok">Added. It is being read and shows below in a minute.</span>}
      {error && <span className="text-[12.5px] font-semibold text-bad" role="alert">{error}</span>}
    </div>
  );
}
