"use client";

import { useState } from "react";
import { BuyerProfileForm, type SaveFn } from "@/components/buyer-profile-form";
import { isIndian, type BuyerBasics, type BuyerProfile } from "@/lib/buyer-profile";
import { money } from "@/lib/format";

// A buyer's details, read at a glance, with Edit opening the form. Missing ones read "To add" in amber.
export function DetailsArea({ profile: p, basics: b, missing, startEditing, save }: {
  profile: BuyerProfile; basics: BuyerBasics; missing: string[]; startEditing: boolean; save: SaveFn;
}) {
  const [editing, setEditing] = useState(startEditing);
  if (editing) return <BuyerProfileForm profile={p} basics={b} team save={save} missing={missing} onDone={p.updated_at ? () => setEditing(false) : undefined} />;
  const india = isIndian(p);
  const shipSame = !!b.delivery_address && b.delivery_address === p.billing_address;
  type Row = { label: string; value: React.ReactNode; key?: string };
  const rows: Row[] = [
    { label: "Legal name", value: p.legal_name, key: "legal_name" },
    { label: "Brand", value: p.brand_name },
    { label: "Country", value: p.country || "India", key: "country" },
  ];
  if (india) rows.push({ label: "GSTIN", value: p.gstin && <span className="code">{p.gstin}</span>, key: "gstin" }, { label: "PAN", value: p.pan && <span className="code">{p.pan}</span>, key: "pan" });
  else {
    rows.push({ label: "Tax or VAT number", value: p.tax_id, key: "tax_id" });
    if (p.eori || missing.includes("eori")) rows.push({ label: "EORI", value: p.eori, key: "eori" });
  }
  rows.push(
    { label: "Billing address", value: p.billing_address, key: "billing_address" },
    { label: "Shipping address", value: shipSame ? "Same as billing" : b.delivery_address, key: "delivery_address" },
  );
  if (p.more_addresses) rows.push({ label: "Other addresses", value: p.more_addresses });
  rows.push(
    { label: "Payment terms", value: [p.payment_terms, b.credit_days != null && `${b.credit_days} days credit`, b.currency && b.currency !== "INR" && b.currency].filter(Boolean).join(" · "), key: "terms" },
    { label: "Deposit and credit", value: [p.deposit_pct != null && `${p.deposit_pct}% deposit`, p.credit_limit != null && `limit ${money(p.credit_limit)}`].filter(Boolean).join(" · ") },
  );
  if (!india || p.incoterm || p.port || p.consignee) rows.push(
    { label: "Incoterm", value: p.incoterm, key: "incoterm" }, { label: "Port of arrival", value: p.port, key: "port" },
    { label: "Consignee", value: p.consignee, key: "consignee" }, { label: "Notify party", value: p.notify_party, key: "notify_party" },
  );
  rows.push({ label: "Bank for refunds", value: p.bank_account ? [p.bank_holder, p.bank_name, p.bank_account, p.bank_code].filter(Boolean).join(" · ") : null });

  return (
    <div className="stack">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[13.5px]">
        {rows.map(({ label, value, key }) => (
          <div key={label} className="min-w-0">
            <dt className="text-[12px] muted">{label}</dt>
            <dd className="whitespace-pre-line break-words">{value || (key && missing.includes(key) ? <span className="text-warn">To add</span> : <span className="muted">Not given</span>)}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="text-[12px] muted mb-1">People</div>
        {p.contacts.length ? (
          <ul className="text-[13.5px] space-y-1">
            {p.contacts.map((c, i) => (
              <li key={i} className="break-words"><b className="font-medium">{c.name || "No name"}</b>{c.role && <span className="muted"> · {c.role}</span>}
                <span className="muted">{[c.phone, c.whatsapp && c.whatsapp !== c.phone && `WhatsApp ${c.whatsapp}`, c.email].filter(Boolean).map((x) => ` · ${x}`).join("")}</span></li>
            ))}
          </ul>
        ) : <span className="text-warn text-[13.5px]">To add</span>}
      </div>
      <div><button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button></div>
    </div>
  );
}
