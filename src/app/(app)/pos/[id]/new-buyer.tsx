"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { addBuyer } from "../../buyers/actions";

type Field = "realName" | "code";
type Bad = { field?: Field; msg: string } | null;

// For a PO from a buyer that isn't in the list yet: the owner adds the buyer here and it is picked on the order below.
export function NewBuyer({ name, code }: { name: string; code: string }) {
  const router = useRouter();
  const path = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [realName, setRealName] = useState(name);
  const [buyerCode, setBuyerCode] = useState(code);
  const [bad, setBad] = useState<Bad>(null);
  const [pending, start] = useTransition();

  // A message sits under its box, the box is marked, and focus moves there so the next key fixes it.
  const point = (b: Bad) => {
    setBad(b);
    const el = b?.field && formRef.current?.elements.namedItem(b.field);
    if (el instanceof HTMLElement) requestAnimationFrame(() => el.focus());
  };
  // Cancel puts back what the PO said, so opening it again never shows half-typed text or an old message.
  const cancel = () => {
    setRealName(name);
    setBuyerCode(code);
    setBad(null);
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  };

  if (!open) return <button ref={opener} type="button" className="btn sm" onClick={() => setOpen(true)}>Add as a new buyer</button>;
  const at = (k: Field) => ({ name: k, "aria-invalid": bad?.field === k || undefined, "aria-describedby": bad?.field === k ? `nb-${k}-err` : undefined });
  const err = (k: Field) => bad?.field === k ? <small id={`nb-${k}-err`} className="text-bad" role="alert">{bad.msg}</small> : null;
  return (
    <form
      ref={formRef}
      className="stack mt-1 max-w-md"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!realName.trim()) return point({ field: "realName", msg: "Enter the buyer's real name." });
        start(async () => {
          setBad(null);
          try {
            const res = await addBuyer(buyerCode, realName);
            if (res.error || !res.id) return point({ field: res.field, msg: res.error ?? "Couldn't add the buyer." });
            toast(`${realName.trim().replace(/\s+/g, " ")} added.`);
            router.replace(`${path}?buyer=${res.id}`);
            router.refresh();
          } catch (x) {
            point({ msg: caught(x, "Couldn't add the buyer. Try again.") });
          }
        });
      }}
    >
      <label className="field"><span>Buyer&apos;s real name</span>
        <input className="inp" value={realName} onChange={(e) => { setRealName(e.target.value); if (bad?.field === "realName") setBad(null); }} required autoFocus {...at("realName")} />
        {err("realName")}
      </label>
      <label className="field"><span>Buyer code</span>
        <input className="inp code" value={buyerCode} onChange={(e) => { setBuyerCode(e.target.value); if (bad?.field === "code") setBad(null); }} placeholder="BYR-OZ" autoCapitalize="characters" required {...at("code")} />
        {err("code")}
      </label>
      {bad && !bad.field && <div className="errbox" role="alert">{bad.msg}</div>}
      <div className="row">
        <button type="submit" className="btn primary sm" disabled={pending}>{pending ? "Adding…" : "Add buyer"}</button>
        <button type="button" className="btn sm" disabled={pending} onClick={cancel}>Cancel</button>
      </div>
    </form>
  );
}
