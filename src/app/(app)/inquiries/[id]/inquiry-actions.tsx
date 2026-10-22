"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { uploadPhotos } from "@/lib/photos";
import { toast } from "@/components/toast";
import { addInquiryBuyer, setInquiryPhotos, setInquiryStatus } from "../actions";

type Photo = { path: string; url: string };

// The rest of what the team does on an inquiry: the owner adds a new buyer, a lost one opens again, and its photos.
export function InquiryActions({ id, companyId, status, hasBuyer, prospect, newBuyerCode, isOwner, photos, allPhotos }: {
  id: string;
  companyId: string;
  status: string;
  hasBuyer: boolean;
  prospect: string;
  // A code for the new buyer, for the owner to add them here.
  newBuyerCode: string;
  isOwner: boolean;
  photos: Photo[];
  allPhotos: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "buyer">("");
  const [buyerNameIn, setBuyerNameIn] = useState(prospect);
  const [buyerCode, setBuyerCode] = useState(newBuyerCode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  const open = status === "new" || status === "quoted";

  function run(label: string, job: () => Promise<{ error?: string }>, done: string, after?: () => void) {
    setError("");
    setBusy(label);
    start(async () => {
      const res = await job();
      setBusy("");
      if (res.error) return setError(res.error);
      toast(done);
      after?.();
      router.refresh();
    });
  }

  function addPhotos(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (allPhotos.length + files.length > 12) return setError("An inquiry can keep up to 12 photos. Remove some first.");
    run("photos", async () => {
      try {
        const paths = await uploadPhotos(`${companyId}/inquiries/${id}`, files);
        return await setInquiryPhotos(id, [...allPhotos, ...paths]);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "The photos didn't upload." };
      }
    }, files.length === 1 ? "Photo added" : `${files.length} photos added`);
  }

  return (
    <>
      {open && !hasBuyer && (
        <div className="panel">
          {!isOwner && (
            <p className="text-[13.5px] text-warn">
              {prospect} isn&apos;t a buyer in the app yet. Ask the owner to open this inquiry and add them; then you can make the order.
            </p>
          )}
          {isOwner && mode !== "buyer" && (
            <div className="row !gap-2 text-[13.5px]">
              <span className="grow">{prospect} isn&apos;t a buyer in the app yet. Add them when they confirm, to make the order.</span>
              <button type="button" className="btn sm" onClick={() => setMode("buyer")}>Add {prospect || "them"} as a buyer</button>
            </div>
          )}
          {isOwner && mode === "buyer" && (
            <div className="inq-choice !mt-0">
              <div className="fgrid">
                <label className="field">
                  <span>Buyer&apos;s real name <i>*</i></span>
                  <input className="inp" value={buyerNameIn} onChange={(e) => setBuyerNameIn(e.target.value)} maxLength={120} autoFocus />
                </label>
                <label className="field">
                  <span>Code <i>*</i></span>
                  <input className="inp code" value={buyerCode} onChange={(e) => setBuyerCode(e.target.value)} maxLength={20} />
                </label>
              </div>
              <div className="row">
                <button type="button" className="btn primary" disabled={pending || !buyerNameIn.trim() || !buyerCode.trim()}
                  onClick={() => run("buyer", () => addInquiryBuyer(id, buyerCode, buyerNameIn), `${buyerNameIn.trim()} added to Buyers. Make the order when they confirm.`, () => setMode(""))}>
                  {busy === "buyer" ? "Adding…" : "Add buyer"}
                </button>
                <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
        </div>
      )}

      {status === "lost" && (
        <div className="panel row">
          <span className="grow text-[13.5px]">The buyer came back? Open it again to follow up.</span>
          <button type="button" className="btn" disabled={pending} onClick={() => run("reopen", () => setInquiryStatus(id, "new", {}), "Inquiry opened again")}>
            {busy === "reopen" ? "Saving…" : "Open again"}
          </button>
          {error && <p className="w-full text-[13px] font-semibold text-bad" role="alert">{error}</p>}
        </div>
      )}

      <div className="panel">
        <h2>Photos</h2>
        <div className="fphotos">
          {photos.map((p) => (
            <div key={p.path} className="fphoto">
              <a href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                <img src={p.url} alt="Inquiry reference" />
              </a>
              {open && (
                <button type="button" aria-label="Remove photo" disabled={pending}
                  onClick={() => run("rm", () => setInquiryPhotos(id, allPhotos.filter((x) => x !== p.path)), "Photo removed")}>×</button>
              )}
            </div>
          ))}
          {open && allPhotos.length < 12 && (
            <label className={`fphoto-add ${pending ? "pointer-events-none opacity-50" : ""}`}>
              <span aria-hidden>+</span>{busy === "photos" ? "Uploading…" : "Add photos"}
              <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {!photos.length && !open && <p className="muted text-[13px]">No photos.</p>}
        {!open && error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      </div>
    </>
  );
}
