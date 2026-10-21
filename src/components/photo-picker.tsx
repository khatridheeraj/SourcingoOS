"use client";

import { useEffect, useRef } from "react";

export type Picked = { file: File; url: string };

// Photos picked on a phone: one button opens the camera, the other the gallery. Each shows as a square with a remove
// button. Nothing is uploaded here; the form uploads on send.
export function PhotoPicker({ files, onChange, max = 10, disabled, label, words }: {
  files: Picked[]; onChange: (f: Picked[]) => void; max?: number; disabled?: boolean; label: string;
  words?: { camera: string; gallery: string; remove: (n: number) => string };
}) {
  const w = words ?? { camera: "Camera", gallery: "Gallery", remove: (n: number) => `Remove photo ${n}` };
  // Previews are freed when the picker goes away.
  const live = useRef(files);
  useEffect(() => { live.current = files; }, [files]);
  useEffect(() => () => live.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []).map((file) => ({ file, url: URL.createObjectURL(file) }));
    const next = [...files, ...picked];
    next.slice(max).forEach((f) => URL.revokeObjectURL(f.url));
    onChange(next.slice(0, max));
  }
  function drop(i: number) {
    URL.revokeObjectURL(files[i].url);
    onChange(files.filter((_, j) => j !== i));
  }

  return (
    <div className="field">
      <span>{label} ({files.length}/{max})</span>
      <div className="fphotos">
        {files.map((f, i) => (
          <div key={f.url} className="fphoto">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a photo not yet sent */}
            <img src={f.url} alt="" />
            <button type="button" aria-label={w.remove(i + 1)} disabled={disabled} onClick={() => drop(i)}>×</button>
          </div>
        ))}
        {files.length < max && (
          <>
            <label className={`fphoto-add ${disabled ? "pointer-events-none opacity-50" : ""}`}>
              <span aria-hidden>+</span>{w.camera}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </label>
            <label className={`fphoto-add ${disabled ? "pointer-events-none opacity-50" : ""}`}>
              <span aria-hidden>+</span>{w.gallery}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
