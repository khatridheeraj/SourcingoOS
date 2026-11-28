"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FactoryDetailsForm } from "@/components/factory-details-form";
import type { Factory } from "@/lib/data";
import type { Gaps, Kyc } from "@/lib/factory-kyc";
import { addFactory } from "./actions";
import { FactoryLink } from "./factory-link";

export type RecordCell = { line: string; tone: string; verified: boolean };

const BLANK: Kyc = {
  legal_name: "", gstin: "", no_gst_reason: "", pan: "", udyam_no: "", address: "", city: "", state: "", pin: "", contact_name: "", phone: "",
  whatsapp: "", email: "", bank_holder: "", bank_account: "", bank_ifsc: "", bank_name: "", pay_days: "",
};

export function FactoryList({ factories, openStyles, records = {}, gaps = {} }: { factories: Factory[]; openStyles: Record<string, number>; records?: Record<string, RecordCell>; gaps?: Record<string, Gaps> }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const notReady = factories.filter((f) => f.active && gaps[f.id]?.missing.length).length;

  return (
    <div className="stack">
      {!adding && (
        <div className="row">
          <button className="btn primary" data-add-factory onClick={() => setAdding(true)}>Add factory</button>
          {notReady > 0 && <span className="text-[13px] text-warn">{notReady} of {factories.filter((f) => f.active).length} active factories aren&apos;t ready for POs yet</span>}
        </div>
      )}
      {adding && (
        <section className="panel stack scroll-mt-20">
          <div>
            <h2 className="font-bold">Add factory</h2>
            <p className="muted text-[13px]">Take everything now, so its first PO isn&apos;t held up. The GST certificate, PAN card, cancelled cheque and signed agreement are uploaded on the next screen.</p>
          </div>
          <FactoryDetailsForm initial={BLANK} extras={{ name: "", notes: "", active: true }} mode="team" submitLabel="Add factory"
            onSave={async (k, x) => {
              const r = await addFactory(x!.name, k, x!.notes);
              if (r.id) router.push(`/factories/${r.id}#details`);
              return r;
            }}
            onDone={() => setAdding(false)} />
        </section>
      )}

      {factories.length === 0 ? (
        <div className="empty"><b>No factories yet</b>Add your factories, or send Claude the confirmed list.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl stack">
            <thead><tr><th>Name</th><th>City</th><th>Contact</th><th>Phone</th><th>Record</th><th className="r">Open styles</th><th></th><th></th></tr></thead>
            <tbody>
              {factories.map((f) => {
                const g = gaps[f.id];
                return (
                  <tr key={f.id}>
                    <td className="font-semibold"><Link className="link" href={`/factories/${f.id}`}>{f.name}</Link></td>
                    <td>{f.city}</td>
                    <td data-label={f.contact_name ? "Contact" : undefined}>{f.contact_name}</td>
                    <td>{f.phone && <a className="link" href={`tel:${f.phone}`}>{f.phone}</a>}</td>
                    <td data-label="Record">
                      <Link href={`/factories/${f.id}`} className={`text-[13px] ${records[f.id]?.tone === "warn" ? "text-warn" : "muted"}`}>
                        {records[f.id]?.verified && <span className="chip mr-1.5">Verified</span>}{records[f.id]?.line ?? "Open record"}
                      </Link>
                    </td>
                    <td className="r num" data-label="Open styles">{openStyles[f.id] ?? 0}</td>
                    <td>
                      {!f.active ? <span className="chip">Inactive</span>
                        : g && g.missing.length > 0 && <Link href={`/factories/${f.id}#details`} className="chip warn" title={g.missing.join(", ")}>{g.missing.length} details missing</Link>}
                    </td>
                    <td className="r">
                      <div className="row justify-end flex-nowrap">
                        {f.active && <FactoryLink factoryId={f.id} name={f.name} phone={f.phone} />}
                        <Link className="btn sm" data-edit={f.id} href={`/factories/${f.id}#details`}>Edit</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
