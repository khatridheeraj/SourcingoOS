"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { dayAtNear } from "@/lib/format";
import { addFromApplication, markApplication } from "./actions";

export type Application = { id: string; name: string; city: string; contact_name: string; phone: string; email: string | null; makes: string;
  pieces_month: number | null; people: number | null; message: string | null; status: string; created_at: string;
  ref_factory?: { name: string } | null; ref_buyer?: { code: string } | null };

// Factories that asked to join on the website. New ones wait for a call; once called they wait to be added or turned down.
export function AskedToJoin({ rows, today }: { rows: Application[]; today: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  // Makes it a factory and opens its record, where the panel link goes to the factory on WhatsApp.
  const add = (a: Application) =>
    start(async () => {
      const r = await addFromApplication(a.id);
      if (r.error) return toast(r.error, "bad");
      toast(`${a.name} added. Send it its panel link to fill its profile.`, "ok");
      router.push(`/factories/${r.factoryId}`);
    });
  const mark = (a: Application, s: "contacted" | "added" | "declined", said: string) =>
    start(async () => {
      const r = await markApplication(a.id, s);
      toast(r.error ?? `${a.name}: ${said}`, r.error ? "bad" : "ok");
    });
  if (!rows.length) return null;
  return (
    <section id="asked" className="panel stack scroll-mt-20" aria-labelledby="asked-h">
      <div>
        <h2 id="asked-h" className="font-bold">Asked to join <span className="muted font-normal num">{rows.length}</span></h2>
        <p className="muted text-[13px]">From the website. Call them. Add the good ones: each fills its own profile from its panel, then asks for a visit.</p>
      </div>
      <ul className="stack" style={{ gap: 0 }}>
        {rows.map((a) => (
          <li key={a.id} className="asked-row">
            <div className="grow">
              <div className="font-semibold">{a.name} <span className="muted font-normal">· {a.city}</span>{a.status === "new" ? <span className="chip warn" style={{ marginLeft: 8 }}>To call</span> : null}</div>
              <div className="text-[13px]">{a.makes}{a.pieces_month ? ` · ${a.pieces_month.toLocaleString("en-IN")} pcs a month` : ""}{a.people ? ` · ${a.people} people` : ""}</div>
              <div className="muted text-[13px]">
                {a.contact_name} · <a className="link" href={`tel:${a.phone.replace(/[^+\d]/g, "")}`}>{a.phone}</a>
                {a.email ? <> · <a className="link" href={`mailto:${a.email}`}>{a.email}</a></> : null} · asked {dayAtNear(a.created_at, today)}
              </div>
              {a.ref_factory || a.ref_buyer ? <p className="text-[13px]" style={{ marginTop: 4 }}>Sent by {a.ref_factory ? `${a.ref_factory.name}, one of our factories` : `${a.ref_buyer!.code}, a buyer`}</p> : null}
              {a.message ? <p className="muted text-[13px]" style={{ marginTop: 4 }}>“{a.message}”</p> : null}
            </div>
            <div className="row asked-actions">
              {a.status === "new"
                ? <button className="btn primary" disabled={pending} onClick={() => mark(a, "contacted", "marked called")}>Called</button>
                : <button className="btn primary" disabled={pending} onClick={() => add(a)}>Add as factory</button>}
              <button className="btn" disabled={pending} onClick={() => mark(a, "declined", "not for now")}>Not for us</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
