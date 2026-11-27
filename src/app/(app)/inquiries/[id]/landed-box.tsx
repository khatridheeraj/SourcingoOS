"use client";

import { COUNTRIES, CURRENCIES, countryOf, landed, landedProblem, rateFor, startInput, type Fx, type LandedInput } from "@/lib/landed";
import { LandedTable } from "@/components/landed-table";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { REGION_NAMES } from "@/lib/landed";
import { saveFreightRate } from "../actions";

// The delivered price an overseas buyer sees beside the price: freight, insurance and the duty in its country, in its
// currency. Off for buyers in India; one tap adds it. Every number can be changed.
export function LandedBox({ value, onChange, price, fx, rates, fabric, startCountry }: {
  value: LandedInput | null; onChange: (v: LandedInput | null) => void; price: number; fx: Fx; rates: unknown; fabric: boolean; startCountry: string | null;
}) {
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  if (!value) {
    return (
      <button type="button" className="btn ghost sm cost-add" onClick={() => onChange(startInput(countryOf(startCountry) ?? countryOf("US")!, fabric, rates))}>
        + Delivered price for an overseas buyer
      </button>
    );
  }
  const c = countryOf(value.country);
  const l = landed(price, value, fx, fabric);
  const problem = landedProblem(value, fx);
  const set = (k: keyof LandedInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const unit = fabric ? "metre" : "piece";

  return (
    <div className="land" aria-labelledby="land-h">
      <div className="land-head">
        <h3 id="land-h">Delivered price <small>to the buyer&apos;s door, an estimate</small></h3>
        <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>Remove</button>
      </div>
      <div className="land-grid">
        <label className="field"><span>Buyer&apos;s country</span>
          <select className="inp" value={value.country} onChange={(e) => {
            const n = countryOf(e.target.value);
            if (n) onChange({ ...startInput(n, fabric, rates), mode: value.mode, kg: value.kg, insurance: value.insurance,
              freight: String(rateFor(rates, n.region, value.mode)) });
          }}>
            {COUNTRIES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Currency</span>
          <select className="inp" value={value.currency} onChange={set("currency")}>
            {CURRENCIES.filter((k) => fx.inr[k]).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <div className="field"><span>Ships by</span>
          <div className="seg" role="radiogroup" aria-label="Ships by">
            {(["sea", "air"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={value.mode === m}
                onClick={() => onChange({ ...value, mode: m, freight: c ? String(rateFor(rates, c.region, m)) : value.freight })}>{m === "sea" ? "Sea" : "Air"}</button>
            ))}
          </div>
        </div>
        <label className="field"><span>Weight a {unit}</span>
          <span className="cost-num"><input className="inp num" inputMode="decimal" value={value.kg} maxLength={6} onChange={set("kg")} /><span>kg</span></span>
        </label>
        <label className="field"><span>Freight to the door</span>
          <span className="cost-num"><span>₹</span><input className="inp num" inputMode="decimal" value={value.freight} maxLength={6} onChange={set("freight")} /><span>/kg</span></span>
        </label>
        <label className="field"><span>Insurance</span>
          <span className="cost-num"><input className="inp num" inputMode="decimal" value={value.insurance} maxLength={5} onChange={set("insurance")} /><span>%</span></span>
        </label>
        <label className="field"><span>Import duty {c ? `(${c.basis === "fob" ? "on the goods" : "on goods + freight"})` : ""}</span>
          <span className="cost-num"><input className="inp num" inputMode="decimal" value={value.duty} maxLength={5} onChange={set("duty")} /><span>%</span></span>
        </label>
      </div>
      {c && (() => {
        const typed = Number(value.freight), key = `${c.region}.${value.mode}`, ours = saved[key] ?? rateFor(rates, c.region, value.mode);
        return typed >= 0 && value.freight.trim() !== "" && typed !== ours ? (
          <button type="button" className="link text-[12.5px] self-start" disabled={pending} onClick={() => start(async () => {
            const res = await saveFreightRate(c.region, value.mode, typed);
            if (res.error) return toast(res.error, "bad");
            setSaved({ ...saved, [key]: typed });
            toast(`₹${typed} a kg is now our ${value.mode} rate to ${REGION_NAMES[c.region]}.`);
          })}>Use ₹{typed} a kg for every {value.mode} quote to {REGION_NAMES[c.region]}</button>
        ) : null;
      })()}
      {c?.note && <p className="land-note">{c.note}</p>}
      {problem ? <p className="text-[13px] text-warn">{problem}</p> : !l ? <p className="text-[13px] text-muted">Enter the price a {unit} above to see it delivered.</p> : <LandedTable l={l} inr={price} />}
      <p className="text-[12px] text-muted num">
        {value.currency} 1 = ₹{fx.inr[value.currency]?.toFixed(2)}{fx.live ? `, rate of ${fx.date}` : ", a rough rate: today's could not be fetched"}. The buyer sees this marked as an estimate; local taxes like VAT are not included.
      </p>
    </div>
  );
}
