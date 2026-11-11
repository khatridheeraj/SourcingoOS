import { factoryRecord, MIN_CHECKS, MIN_SHIPMENTS, MIN_STEPS, type RecordFacts } from "@/lib/factory-record";
import { day, todayIST } from "@/lib/format";
import type { Lang } from "./i18n";

const WORDS = {
  en: {
    title: "Your Sourcingo record",
    sub: "Buyers and Sourcingo choose factories by this record. Finish each step by its date and pass Final QC the first time to keep it high.",
    onTime: "steps on time",
    firstPass: "passed Final QC first time",
    shipped: "shipped by the ship date",
    after: (n: number, what: string) => `Shows after ${n} ${what}`,
    steps: "steps", styles: "styles checked", shipments: "shipments",
    verified: (d: string) => `Verified by Sourcingo on ${d}`,
    notVisited: "Sourcingo's team has not visited yet. A visit makes you a verified factory.",
    old: (d: string) => `Last visit ${d}, over a year ago. Ask Sourcingo for a new visit.`,
    soon: (n: string, d: string) => `${n} runs out on ${d}: send the renewed certificate to Sourcingo.`,
    gone: (n: string, d: string) => `${n} ran out on ${d}: send the renewed certificate to Sourcingo.`,
  },
  hi: {
    title: "Sourcingo पर आपका रिकॉर्ड",
    sub: "खरीदार और Sourcingo इसी रिकॉर्ड से फैक्ट्री चुनते हैं। हर स्टेप उसकी तारीख तक पूरा करें और फाइनल QC पहली बार में पास करें।",
    onTime: "स्टेप समय पर",
    firstPass: "फाइनल QC पहली बार में पास",
    shipped: "शिप डेट तक भेजा",
    after: (n: number, what: string) => `${n} ${what} के बाद दिखेगा`,
    steps: "स्टेप", styles: "स्टाइल चेक", shipments: "शिपमेंट",
    verified: (d: string) => `Sourcingo ने ${d} को जाँचा`,
    notVisited: "Sourcingo की टीम अभी विज़िट पर नहीं आई। विज़िट के बाद आप जाँची हुई फैक्ट्री बनेंगे।",
    old: (d: string) => `आखिरी विज़िट ${d}, एक साल से पुरानी। Sourcingo से नई विज़िट के लिए कहें।`,
    soon: (n: string, d: string) => `${n} ${d} को ख़त्म हो रहा है: नया सर्टिफिकेट Sourcingo को भेजें।`,
    gone: (n: string, d: string) => `${n} ${d} को ख़त्म हो गया: नया सर्टिफिकेट Sourcingo को भेजें।`,
  },
} as const;

// The factory's own record in its panel: the same numbers buyers and our team judge it by, so it knows what wins work.
export function FactoryRecordCard({ facts, lang }: { facts: RecordFacts | null; lang: Lang }) {
  if (!facts) return null;
  const w = WORDS[lang];
  const r = factoryRecord(facts, todayIST());
  const nums = [
    { v: r.onTime, label: w.onTime, after: w.after(MIN_STEPS, w.steps) },
    { v: r.firstPass, label: w.firstPass, after: w.after(MIN_CHECKS, w.styles) },
    { v: r.shipOnTime, label: w.shipped, after: w.after(MIN_SHIPMENTS, w.shipments) },
  ];
  const certs = r.certs.filter((c) => c.state !== "ok" && c.until);
  return (
    <section className="panel frec" aria-labelledby="frec-h">
      <div>
        <h2 id="frec-h" className="font-bold">{w.title}</h2>
        <p className="muted text-[13px]">{w.sub}</p>
      </div>
      <div className="frec-nums">
        {nums.map((n) => (
          <div key={n.label}>
            <b className={n.v != null && n.v < 70 ? "low" : undefined}>{n.v == null ? "–" : `${n.v}%`}</b>
            <span>{n.v == null ? n.after : n.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[13px]">
        {r.visit?.current ? <span className="chip">{w.verified(day(r.visit.on))}</span>
          : <span className="muted">{r.visit ? w.old(day(r.visit.on)) : w.notVisited}</span>}
      </p>
      {certs.map((c) => (
        <p key={c.name} className={`text-[13px] font-semibold ${c.state === "expired" ? "text-bad" : "text-warn"}`}>
          {c.state === "expired" ? w.gone(c.name, day(c.until)) : w.soon(c.name, day(c.until))}
        </p>
      ))}
    </section>
  );
}
