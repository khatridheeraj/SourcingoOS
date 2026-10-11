"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PO_FILE_TYPES, PO_MAX_BYTES, PO_BUCKET, type StoredFile } from "@/lib/po-files";
import { createClient } from "@/lib/supabase/client";
import { addPoFiles } from "./actions";

const ACCEPT = Object.keys(PO_FILE_TYPES).map((e) => `.${e}`).join(",");

// Add a PO that came another way, such as a WhatsApp group: pick the PO's file (or photos of its pages) and the AI reads it.
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
    start(async () => {
      const id = crypto.randomUUID();
      const supabase = createClient();
      const stored: StoredFile[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        const type = PO_FILE_TYPES[ext];
        if (!type) return setError(`${f.name} isn't a PDF, Excel, CSV or photo.`);
        if (f.size > PO_MAX_BYTES) return setError(`${f.name} is over 25 MB.`);
        const path = `${companyId}/${id}/${crypto.randomUUID()}.${ext}`;
        const { error: up } = await supabase.storage.from(PO_BUCKET).upload(path, f, { contentType: type });
        if (up) return setError(`Couldn't upload ${f.name}: ${up.message}`);
        stored.push({ path, name: f.name, type, size: f.size });
      }
      const res = await addPoFiles(id, stored);
      if (res.error) return setError(res.error);
      if (input.current) input.current.value = "";
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="panel">
      <h2>Add a PO from a file</h2>
      <p className="muted text-[13px]">For POs that came on WhatsApp or by hand. Pick the PO file, or photos of all its pages together. The AI reads it into a draft for you to check.</p>
      <div className="row mt-3">
        <label className={`btn primary ${pending ? "opacity-60" : ""}`}>
          {pending ? "Uploading…" : "Choose PO file"}
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" disabled={pending}
            onChange={(e) => upload(e.target.files)} aria-label="PO file" />
        </label>
        {done && !error && <span className="text-[13px] font-semibold text-ok">Added. The AI is reading it; it shows below in a minute.</span>}
        {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
      </div>
    </div>
  );
}
