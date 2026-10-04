import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";

export type Company = {
  legal_name: string; trade_name: string; address: string | null; gstin: string | null; pan: string | null; phone: string | null;
  email: string | null; website: string | null; bank_name: string | null; bank_account: string | null; bank_ifsc: string | null;
};

export async function loadCompany() {
  const supabase = await createClient();
  const { data } = await supabase.from("company_profile").select("*").maybeSingle();
  return (data ?? { legal_name: "Sourcingo", trade_name: "Sourcingo" }) as Company;
}

export function Letterhead({ c, title, number, sub }: { c: Company; title: string; number: string; sub?: React.ReactNode }) {
  return (
    <>
      <div className="print-bar"><PrintButton /></div>
      <header className="lh">
        <div>
          <b className="lh-name">{c.trade_name}</b>
          {c.legal_name !== c.trade_name && <div>{c.legal_name}</div>}
          {c.address && <div className="whitespace-pre-line">{c.address}</div>}
          <div>{[c.phone, c.email, c.website].filter(Boolean).join(" · ")}</div>
          {(c.gstin || c.pan) && <div>{[c.gstin && `GSTIN ${c.gstin}`, c.pan && `PAN ${c.pan}`].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="lh-doc">
          <b>{title}</b>
          <div className="code">{number}</div>
          {sub}
        </div>
      </header>
    </>
  );
}

export function Signatures({ left, right }: { left: string; right: string }) {
  return (
    <div className="sigs">
      <div><span />{left}</div>
      <div><span />{right}</div>
    </div>
  );
}
