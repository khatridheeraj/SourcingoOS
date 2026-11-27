"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { addPerson, personLink, stopPerson } from "../../actions";

export type Person = { id: string; name: string; job: string; phone: string | null; email: string | null; stopped: boolean; added: string };

export const JOBS: { value: string; label: string }[] = [
  { value: "sourcing", label: "Sourcing or buying" }, { value: "design", label: "Design" }, { value: "quality", label: "Quality" },
  { value: "accounts", label: "Accounts" }, { value: "owner", label: "Owner" }, { value: "other", label: "Something else" },
];
const jobLabel = (j: string) => JOBS.find((x) => x.value === j)?.label ?? j;

function message(person: string, buyer: string, url: string) {
  return `Hello ${person},\nThis is your own link to ${buyer}'s orders with Sourcingo: where each style is, photos checked by our team, final QC and ship dates. Messages you write there carry your name. No password needed.\n\n${url}\n\nPlease keep it to yourself; each person at ${buyer} has their own.`;
}
// wa.me wants the number as digits with its country code.
const waTo = (phone: string | null) => (phone ? phone.replace(/\D/g, "") : "");

type Field = "name" | "job" | "phone" | "email";
// Which field a refusal from the database is about, so it shows under that field.
const fieldOf = (msg: string): Field | undefined =>
  /name|already has a link/i.test(msg) ? "name" : /WhatsApp number/i.test(msg) ? "phone" : /email/i.test(msg) ? "email" : /what the person does/i.test(msg) ? "job" : undefined;

// The people at one buyer, each with their own link, and a short form to add another.
export function People({ buyerId, buyer, people }: { buyerId: string; buyer: string; people: Person[] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [v, setV] = useState({ name: "", job: "sourcing", phone: "", email: "" });
  const [bad, setBad] = useState<{ field?: Field; msg: string } | null>(null);
  const [open, setOpen] = useState<{ id: string; url: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const at = (k: Field) => ({ name: k, "aria-invalid": bad?.field === k || undefined });
  const err = (k: Field) => (bad?.field === k ? <small className="text-bad" role="alert">{bad.msg}</small> : null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setBad(null);
    start(async () => {
      const r = await addPerson({ buyerId, ...v });
      if (r.error) {
        const field = fieldOf(r.error);
        setBad({ field, msg: r.error });
        const el = field && form.current?.elements.namedItem(field);
        if (el instanceof HTMLElement) el.focus();
        return;
      }
      toast(`${v.name.trim()} has their own link now. Send it below.`);
      setV({ name: "", job: "sourcing", phone: "", email: "" });
      if (r.id && r.url) setOpen({ id: r.id, url: r.url });
      router.refresh();
    });
  }
  function show(p: Person, renew = false) {
    start(async () => {
      const r = await personLink(p.id, renew);
      if (r.error) toast(r.error, "bad");
      else {
        setOpen({ id: p.id, url: r.url! });
        if (renew) { toast(`New link made for ${p.name}. Their old link has stopped working.`); router.refresh(); }
      }
    });
  }
  function stop(p: Person) {
    start(async () => {
      const r = await stopPerson(p.id, buyerId);
      if (r.error) toast(r.error, "bad");
      else { toast(`${p.name}'s link has stopped working.`); setConfirmStop(null); setOpen(null); router.refresh(); }
    });
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in your chat or email."); }
    catch { toast("Couldn't copy. Select the text and copy it.", "bad"); }
  }

  return (
    <>
      <section className="card" aria-labelledby="people-h">
        <div className="card-h">
          <div>
            <h2 id="people-h">{people.filter((p) => !p.stopped).length === 1 ? "1 person" : `${people.filter((p) => !p.stopped).length} people`} with their own link</h2>
            <p>Each sees {buyer}&apos;s page. Never factories or rates.</p>
          </div>
        </div>
        {people.length === 0 ? (
          <p className="card-empty">Nobody yet. Add the people at {buyer} who follow orders, so each message shows who wrote it.</p>
        ) : (
          <ul className="rows">
            {people.map((p) => {
              const text = open?.id === p.id ? message(p.name.split(" ")[0], buyer, open.url) : "";
              return (
                <li key={p.id} className="bp-row">
                  <div className="bp-main">
                    <span className="bp-id">
                      <b>{p.name}</b>
                      <span>{[jobLabel(p.job), p.phone, p.email].filter(Boolean).join(" · ")}{p.stopped ? " · link stopped" : ""}</span>
                    </span>
                    <span className="bp-acts">
                      {p.stopped ? (
                        <button type="button" className="btn sm" disabled={pending} onClick={() => show(p, true)}>Switch back on</button>
                      ) : (
                        <button type="button" className="btn sm" disabled={pending} onClick={() => (open?.id === p.id ? setOpen(null) : show(p))}>
                          {open?.id === p.id ? "Close" : "Send link"}
                        </button>
                      )}
                    </span>
                  </div>
                  {open?.id === p.id && (
                    <div className="bp-send">
                      <textarea className="inp h-40 w-full resize-none font-[inherit] leading-relaxed" value={text} readOnly aria-label={`Message to ${p.name}`} />
                      <div className="bp-send-acts">
                        <a className="btn primary" href={`https://wa.me/${waTo(p.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp {p.name.split(" ")[0]}</a>
                        {p.email && <a className="btn" href={`mailto:${p.email}?subject=${encodeURIComponent(`Your link to ${buyer}'s orders`)}&body=${encodeURIComponent(text)}`}>Email</a>}
                        <button type="button" className="btn" onClick={() => copy(text)}>Copy</button>
                      </div>
                      <div className="text-[12.5px] text-muted">
                        {confirmStop === p.id ? (
                          <span className="row">
                            Stop {p.name}&apos;s link? Their phone is signed out at once.
                            <button type="button" className="btn sm danger" disabled={pending} onClick={() => stop(p)}>Stop link</button>
                            <button type="button" className="btn sm ghost" onClick={() => setConfirmStop(null)}>Keep</button>
                          </span>
                        ) : (
                          <span className="row">
                            <button type="button" className="link" onClick={() => setConfirmStop(p.id)}>{p.name.split(" ")[0]} left {buyer}? Stop the link</button>
                            <button type="button" className="link" disabled={pending} onClick={() => show(p, true)}>Sent to the wrong number? Make a new link</button>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form ref={form} className="panel" onSubmit={add} noValidate>
        <h2>Add a person at {buyer}</h2>
        <div className="fgrid">
          <label className="field">
            <span>Name <i>*</i></span>
            <input className="inp" value={v.name} onChange={set("name")} required maxLength={80} placeholder="Amy Hart" autoComplete="off" {...at("name")} />
            {err("name")}
          </label>
          <label className="field">
            <span>What they do</span>
            <select className="inp" value={v.job} onChange={set("job")} {...at("job")}>
              {JOBS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
            </select>
            {err("job")}
          </label>
          <label className="field">
            <span>WhatsApp number</span>
            <input className="inp" value={v.phone} onChange={set("phone")} maxLength={30} inputMode="tel" placeholder="+44 7700 900123" autoComplete="off" {...at("phone")} />
            {err("phone")}
          </label>
          <label className="field">
            <span>Email</span>
            <input className="inp" value={v.email} onChange={set("email")} maxLength={200} inputMode="email" placeholder="amy@brand.com" autoComplete="off" {...at("email")} />
            {err("email")}
          </label>
        </div>
        {bad && !bad.field && <div className="errbox mt-3" role="alert">{bad.msg}</div>}
        <button className="btn primary mt-4 bp-add" disabled={pending}>{pending ? "Adding…" : "Add and make their link"}</button>
        <details className="howto mt-4 border-t border-line pt-3 text-[13px]">
          <summary>How links for people work</summary>
          <p className="mt-2 text-muted">Each person&apos;s link opens {buyer}&apos;s page on their phone with no password. Their messages show their name to our team and to {buyer}. Stopping one person signs only them out. The shared status link on the Buyers page keeps working as before.</p>
        </details>
      </form>
    </>
  );
}
