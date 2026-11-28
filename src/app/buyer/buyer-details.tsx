"use client";

import { useState } from "react";
import { Ring } from "@/components/order-ui";
import { BuyerPapers, BuyerProfileForm } from "@/components/buyer-profile-form";
import { paperKinds, type BuyerBasics, type BuyerDoc, type BuyerProfile, type Item } from "@/lib/buyer-profile";
import { buyerAddDoc, buyerRemoveDoc, buyerSaveProfile } from "./profile-actions";

// The buyer's own company details and papers, on its page. While something is missing it sits near the top and says
// what; once complete it folds away at the end. A team preview reads it with nothing to press.
export function BuyerDetails({ folder, profile, basics, docs, urls, done, total, ready, missing, canWrite }: {
  folder: string; profile: BuyerProfile; basics: BuyerBasics; docs: BuyerDoc[]; urls: Record<string, string>;
  done: number; total: number; ready: boolean; missing: Item[]; canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const theirs = missing.filter((i) => i.from === "buyer");
  const form = canWrite && (
    <div className="stack gap-6 mt-2">
      <BuyerProfileForm profile={profile} basics={basics} team={false} save={buyerSaveProfile} missing={theirs.map((i) => i.key)} />
      <div>
        <h3 className="font-semibold text-[14px] mb-1">Papers</h3>
        <BuyerPapers folder={folder} docs={docs} urls={urls} kinds={paperKinds(profile.country)} add={buyerAddDoc} remove={buyerRemoveDoc} removable="buyer" />
      </div>
    </div>
  );

  if (ready || theirs.length === 0) {
    return (
      <details className="panel" id="company">
        <summary className="cursor-pointer font-semibold text-[15px]">Your company details</summary>
        <p className="muted text-[13px] mt-2">Everything we need to invoice and ship your orders is in. Change anything here if it moves.</p>
        {form || <p className="muted text-[13px]">Preview: the buyer can change these here.</p>}
      </details>
    );
  }
  return (
    <section className="panel stack" id="company" aria-labelledby="company-h">
      <div className="flex items-center gap-4">
        <Ring done={done} total={total} size={52}><b className="num text-[13px]">{Math.round((done / total) * 100)}%</b></Ring>
        <div className="min-w-0">
          <h2 id="company-h" className="text-[16px] font-semibold">Your company details</h2>
          <p className="muted text-[13px]">We need {theirs.length === 1 ? "one thing" : `${theirs.length} things`} from you to invoice and ship your orders without delay.</p>
        </div>
      </div>
      <ul className="text-[13.5px] list-disc pl-5 space-y-0.5">{theirs.map((i) => <li key={i.key}>{i.label}</li>)}</ul>
      {!canWrite ? <p className="muted text-[13px]">Preview: the buyer fills these in and uploads papers here.</p>
        : open ? form
        : <button type="button" className="btn primary w-full sm:w-auto sm:self-start" onClick={() => setOpen(true)}>Fill in your details</button>}
      <details className="text-[13px] muted">
        <summary className="cursor-pointer">Why we ask</summary>
        <p className="mt-1">Your legal name, address and tax numbers print on every invoice and shipping paper. Your papers stay private: only Sourcingo&apos;s orders and accounts team sees them, never a factory.</p>
      </details>
    </section>
  );
}
