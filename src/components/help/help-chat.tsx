"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import type { Role } from "@/lib/auth-roles";
import { guessKind, pageTitle, searchScored, suggestions, type Audience, type NoteKind, type Topic } from "@/lib/help-guide";
import { ATTACH_ACCEPT, uploadAttachments } from "@/lib/photos";
import { checkOrder, loadNotes, logAsk, markSeen, rateAsk, sendNote, type NoteFile, type OrderCheck, type TeamNote } from "./actions";

// An order's own page (or a page inside it) gets Help's live check of that order.
const orderOf = (path: string) => (/^\/orders\/([0-9a-f-]{36})(\/|$)/.exec(path) ?? [])[1] ?? null;
// Questions that read as "why can't I…" on an order get the live check before anything else.
const STUCK = /can'?t|cannot|unable|not able|nahi|why|block|lock|stuck|disabled|grey|done date|release|approv|after po/i;

type Lang = "en" | "hi";
const OPEN = "sourcingo:help";

// Opens Help from anywhere: the menu, the top bar, a page's own link. A draft opens a note to the owner already written.
export function openHelp(tab: "ask" | "notes" = "ask", draft?: string) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { tab, draft } }));
}

const T = {
  en: {
    help: "Help", ask: "Ask", notes: "My notes", close: "Close",
    hello: (n: string, owner: string) => `Hi${n ? ` ${n}` : ""}. Ask how to do anything in the app, or tell ${owner} what's wrong or what could be better. Tap the clip to send a screenshot.`,
    here: (p: string) => (p === "App" ? "Common questions" : `Questions about ${p}`),
    wrong: "Something's wrong", data: "Wrong data", idea: "I have an idea",
    placeholder: "Ask, or describe a problem or idea…", send: "Send",
    helped: "Did this help?", yes: "Yes", no: "No", thanks: "Glad it helped.",
    other: "Or did you mean",
    noAnswer: (o: string) => `I don't have a written answer for that yet. Send it to ${o}, and the answer will show in My notes.`,
    notHelped: (o: string) => `Sorry about that. Send your question to ${o}? The answer will show in My notes.`,
    offer: (k: string, o: string) => `That sounds like ${k}. Want to send it to ${o}?`,
    kindName: { problem: "a problem", wrong_data: "wrong data", idea: "an idea", question: "a question" } as Record<NoteKind, string>,
    kinds: { problem: "Not working", wrong_data: "Wrong data", idea: "Idea", question: "Question" } as Record<NoteKind, string>,
    prompts: {
      problem: "What isn't working? What did you tap, and what happened?",
      wrong_data: "Which order, style or amount is wrong, and what should it be?",
      idea: "What would make the app better for you?",
      question: "What do you want to know?",
    } as Record<NoteKind, string>,
    stagedHint: "Say what's wrong, then send.", stagedPlaceholder: "What's wrong in this screenshot?",
    stillStuck: (o: string) => `Still stuck? Send it to ${o} with your screenshot.`,
    checkChip: "What's blocking this order?", checking: "Checking this order…", checkFail: "Couldn't check this order. Check the internet and try again.",
    photo: "Attach", attachTitle: "Attach a screenshot, photo or file", attachHint: "Screenshot, photo, short video, PDF or Excel. Up to 4.", removePhoto: "Remove",
    from: "Sent from", sendTo: (o: string) => `Send to ${o}`, sending: "Sending…", cancel: "Cancel",
    sent: (no: number, o: string) => `Sent to ${o} as note #${no}. The answer will show in My notes.`,
    sendAsNote: (o: string) => `Send to ${o}`,
    empty: "Nothing sent yet", emptySub: "Problems, wrong data and ideas you send show here with the answer.",
    status: { new: "Waiting", planned: "Going ahead", later: "Later", done: "Done", declined: "Not doing" } as Record<TeamNote["status"], string>,
    replied: (by: string) => `${by} replied`, seeAll: "All team notes", open: "Open",
    loadError: "Couldn't load your notes. Check the internet and try again.",
  },
  hi: {
    help: "मदद", ask: "पूछें", notes: "मेरे संदेश", close: "बंद करें",
    hello: (n: string) => `नमस्ते${n ? ` ${n}` : ""}। ऐप में कुछ भी कैसे करें, पूछिए। या Sourcingo को बताइए कि क्या गड़बड़ है या क्या बेहतर हो सकता है। स्क्रीनशॉट भेजने के लिए क्लिप दबाएँ।`,
    here: () => "इस पेज के सवाल",
    wrong: "कुछ गड़बड़ है", data: "गलत जानकारी", idea: "एक सुझाव",
    placeholder: "सवाल, दिक्कत या सुझाव लिखें…", send: "भेजें",
    helped: "क्या इससे मदद मिली?", yes: "हाँ", no: "नहीं", thanks: "बढ़िया!",
    other: "या आपका मतलब था",
    noAnswer: () => "इसका लिखा हुआ जवाब अभी नहीं है। Sourcingo को भेज दीजिए, जवाब \"मेरे संदेश\" में दिखेगा।",
    notHelped: () => "माफ़ कीजिए। सवाल Sourcingo को भेजें? जवाब \"मेरे संदेश\" में दिखेगा।",
    offer: (k: string) => `यह ${k} लगती है। Sourcingo को भेजें?`,
    kindName: { problem: "एक दिक्कत", wrong_data: "गलत जानकारी", idea: "एक सुझाव", question: "एक सवाल" } as Record<NoteKind, string>,
    kinds: { problem: "दिक्कत", wrong_data: "गलत जानकारी", idea: "सुझाव", question: "सवाल" } as Record<NoteKind, string>,
    prompts: {
      problem: "क्या नहीं चल रहा? आपने क्या दबाया और क्या हुआ?",
      wrong_data: "कौन सा ऑर्डर, स्टाइल या तारीख गलत है, और सही क्या है?",
      idea: "ऐप में क्या बेहतर हो सकता है?",
      question: "आप क्या जानना चाहते हैं?",
    } as Record<NoteKind, string>,
    stagedHint: "क्या गड़बड़ है लिखें, फिर भेजें।", stagedPlaceholder: "इस स्क्रीनशॉट में क्या गड़बड़ है?",
    stillStuck: () => "फिर भी दिक्कत है? स्क्रीनशॉट के साथ Sourcingo को भेजें।",
    checkChip: "यह ऑर्डर कहाँ रुका है?", checking: "ऑर्डर देख रहे हैं…", checkFail: "ऑर्डर नहीं देख पाए। इंटरनेट देखकर फिर कोशिश करें।",
    photo: "फोटो / फाइल जोड़ें", attachTitle: "स्क्रीनशॉट, फोटो या फाइल जोड़ें", attachHint: "फोटो, छोटा वीडियो, PDF या Excel. 4 तक.", removePhoto: "हटाएँ",
    from: "पेज", sendTo: () => "Sourcingo को भेजें", sending: "भेज रहे हैं…", cancel: "रहने दें",
    sent: (no: number) => `Sourcingo को भेज दिया (संदेश #${no})। जवाब "मेरे संदेश" में दिखेगा।`,
    sendAsNote: () => "Sourcingo को भेजें",
    empty: "अभी कुछ नहीं भेजा", emptySub: "आपकी भेजी दिक्कतें और सुझाव जवाब के साथ यहाँ दिखेंगे।",
    status: { new: "इंतज़ार", planned: "हो रहा है", later: "बाद में", done: "हो गया", declined: "नहीं होगा" } as Record<TeamNote["status"], string>,
    replied: (by: string) => `${by} का जवाब`, seeAll: "", open: "खोलें",
    loadError: "संदेश नहीं खुले। इंटरनेट देखकर फिर से खोलें।",
  },
};

type Msg =
  | { id: number; from: "me"; text: string }
  | { id: number; from: "bot"; kind: "hello" }
  | { id: number; from: "bot"; kind: "answer"; topic: Topic; others: Topic[]; askId: string | null; question: string; rated?: boolean }
  | { id: number; from: "bot"; kind: "text"; text: string; offer?: { kind: NoteKind; body: string }; guide?: Topic }
  | { id: number; from: "bot"; kind: "check"; check: OrderCheck | null }
  | { id: number; from: "bot"; kind: "compose"; note: NoteKind; body: string; files?: File[]; done?: boolean };

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewMsg = Without<Msg, "id">;

export function HelpChat({ who, role, name, userId, companyId, ownerName = "Dheeraj", lang = "en", unseen = 0 }:
  { who: Audience; role: Role | null; name: string; userId: string; companyId: string; ownerName?: string; lang?: Lang; unseen?: number }) {
  const w = T[lang];
  const path = usePathname();
  const router = useRouter();
  const box = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"ask" | "notes">("ask");
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: "bot", kind: "hello" }]);
  const [text, setText] = useState("");
  // Files picked from the bar wait here until a note is opened, so Help can answer first.
  const [staged, setStaged] = useState<File[]>([]);
  const [notes, setNotes] = useState<TeamNote[] | null>(null);
  const [notesError, setNotesError] = useState("");
  const [vv, setVv] = useState<{ top: number; h: number } | null>(null);
  const next = useRef(1);
  const viewer = { who, role };
  const owner = who === "staff" ? ownerName : "Sourcingo";
  const here = pageTitle(path);
  const orderId = who === "staff" ? orderOf(path) : null;

  useEffect(() => {
    const on = (e: Event) => {
      const { tab: t = "ask", draft } = (e as CustomEvent<{ tab?: "ask" | "notes"; draft?: string }>).detail ?? {};
      setTab(t);
      if (!box.current?.open) box.current?.showModal();
      if (t === "notes") showNotes();
      else if (draft) compose("problem", draft);
      else setTimeout(() => input.current?.focus({ preventScroll: true }), 250);
    };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a phone the keyboard covers the bottom of the screen; the sheet shrinks to the part still visible.
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const fit = () => setVv(window.innerWidth <= 900 ? { top: v.offsetTop, h: v.height } : null);
    fit();
    v.addEventListener("resize", fit);
    v.addEventListener("scroll", fit);
    return () => { v.removeEventListener("resize", fit); v.removeEventListener("scroll", fit); };
  }, []);

  // Each new answer starts at the question that asked it, so a long answer is read from its top.
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const mine = el.querySelectorAll<HTMLElement>(".bub.me");
    const last = mine[mine.length - 1];
    if (last && msgs.length > 1) el.scrollTo({ top: last.offsetTop - el.offsetTop - 12, behavior: "smooth" });
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const push = (...m: NewMsg[]) => setMsgs((all) => [...all, ...m.map((x) => ({ ...x, id: next.current++ }) as Msg)]);
  const patch = (id: number, p: Partial<Msg>) => setMsgs((all) => all.map((m) => (m.id === id ? ({ ...m, ...p } as Msg) : m)));

  // Reads the order's live state and says what blocks it, in the same words the order screen's own rules use.
  function runCheck(id: string) {
    const at = next.current;
    push({ from: "bot", kind: "text", text: w.checking });
    void checkOrder(id).then(
      (check) => setMsgs((all) => all.map((m) => (m.id === at ? { id: at, from: "bot", kind: "check", check } : m))),
      () => patch(at, { text: w.checkFail }),
    );
  }

  function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    setText("");
    push({ from: "me", text: q });
    const scored = searchScored(q, viewer, path);
    if (orderId && STUCK.test(q)) {
      // A question the guide clearly answers (why a date won't pick, say) gets that answer first; the live check follows.
      const strong = scored[0] && scored[0].score >= 10 ? scored[0].t : null;
      if (strong) push({ from: "bot", kind: "answer", topic: strong, others: [], askId: null, question: q });
      runCheck(orderId);
      void logAsk(q, path, strong?.id ?? "order-check");
      return;
    }
    const found = scored.map((s) => s.t);
    const kind = guessKind(q);
    const top = found[0];
    if (kind) {
      void logAsk(q, path, top?.id ?? null);
      // Nothing opens by itself: the note form waits for Send, and a clear guide match waits behind its own button.
      const guide = top && scored[0].score >= 8 ? top : undefined;
      push({ from: "bot", kind: "text", text: w.offer(w.kindName[kind], owner), offer: { kind, body: q }, guide });
      return;
    }
    if (!top) {
      void logAsk(q, path, null);
      push({ from: "bot", kind: "text", text: w.noAnswer(owner), offer: { kind: "question", body: q } });
      return;
    }
    const id = next.current;
    push({ from: "bot", kind: "answer", topic: top, others: found.slice(1), askId: null, question: q });
    if (staged.length) push({ from: "bot", kind: "text", text: w.stillStuck(owner), offer: { kind: "problem", body: q } });
    void logAsk(q, path, top.id).then((askId) => patch(id, { askId }));
  }

  function pickTopic(t: Topic) {
    const q = lang === "hi" && t.hi ? t.hi.q : t.q;
    push({ from: "me", text: q });
    const id = next.current;
    push({ from: "bot", kind: "answer", topic: t, others: [], askId: null, question: q });
    void logAsk(q, path, t.id).then((askId) => patch(id, { askId }));
  }

  function rate(m: Extract<Msg, { kind: "answer" }>, helpful: boolean) {
    patch(m.id, { rated: true });
    if (m.askId) void rateAsk(m.askId, helpful);
    if (helpful) { setStaged([]); push({ from: "bot", kind: "text", text: w.thanks }); }
    else push({ from: "bot", kind: "text", text: w.notHelped(owner), offer: { kind: "question", body: m.question } });
  }

  function compose(kind: NoteKind, body = "") {
    // One open note form at a time: an unsent one is replaced, so two forms never stack up.
    setMsgs((all) => all.filter((m) => !("kind" in m && m.kind === "compose" && !m.done)));
    push({ from: "bot", kind: "compose", note: kind, body, files: staged.length ? staged : undefined });
    setStaged([]);
  }

  // A screenshot waits on the bar: the typed question still gets Help's answer first,
  // and the file rides along if it has to go to the owner.
  function attach(files: File[]) {
    if (!files.length) return;
    setStaged((all) => [...all, ...files].slice(0, 4));
    input.current?.focus({ preventScroll: true });
  }

  function showNotes() {
    setTab("notes");
    setNotesError("");
    void loadNotes().then((r) => {
      setNotes(r.notes.filter((n) => n.mine));
      setNotesError(r.error ? w.loadError : "");
      if (r.notes.some((n) => n.mine && !n.seen)) void markSeen().then(() => router.refresh());
    });
  }

  const ownTopic = (t: Topic) => (lang === "hi" && t.hi ? t.hi : t);
  const sheetStyle = vv ? { top: vv.top + Math.round(vv.h * 0.05), height: Math.round(vv.h * 0.95) } : undefined;

  return (
    <dialog ref={box} className="help-sheet" style={sheetStyle} aria-labelledby="help-h" lang={lang}
      onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
      <div className="help-in">
        <header className="help-top">
          <span className="grabber" aria-hidden />
          <div className="help-title">
            <span className="help-mark" aria-hidden>?</span>
            <h2 id="help-h">{w.help}</h2>
            <button type="button" className="btn ghost sm ml-auto" onClick={() => box.current?.close()}>{w.close}</button>
          </div>
          <div className="seg w-full" role="tablist" aria-label={w.help}>
            <button type="button" role="tab" aria-selected={tab === "ask"} onClick={() => { setTab("ask"); setTimeout(() => input.current?.focus({ preventScroll: true }), 50); }}>{w.ask}</button>
            <button type="button" role="tab" aria-selected={tab === "notes"} onClick={showNotes}>
              {w.notes}{unseen > 0 && <span className="help-dot" aria-label={`${unseen} new`}>{unseen}</span>}
            </button>
          </div>
        </header>

        {tab === "ask" ? (
          <>
            <div ref={log} className="help-log" aria-live="polite">
              {msgs.map((m) => {
                if (m.from === "me") return <div key={m.id} className="bub me">{m.text}</div>;
                if (m.kind === "hello") return (
                  <div key={m.id} className="help-hello">
                    <div className="bub bot">{w.hello(name.split(" ")[0] ?? "", owner)}</div>
                    <div className="help-acts">
                      <button type="button" className="help-chip warn" onClick={() => compose("problem")}>{w.wrong}</button>
                      {who !== "buyer" && <button type="button" className="help-chip warn" onClick={() => compose("wrong_data")}>{w.data}</button>}
                      <button type="button" className="help-chip ok" onClick={() => compose("idea")}>{w.idea}</button>
                    </div>
                    <p className="help-label">{w.here(here)}</p>
                    <div className="help-sugs">
                      {orderId && (
                        <button type="button" className="help-sug" onClick={() => { push({ from: "me", text: w.checkChip }); runCheck(orderId); }}>{w.checkChip}<span aria-hidden>›</span></button>
                      )}
                      {suggestions(viewer, path).map((t) => (
                        <button key={t.id} type="button" className="help-sug" onClick={() => pickTopic(t)}>{ownTopic(t).q}<span aria-hidden>›</span></button>
                      ))}
                    </div>
                  </div>
                );
                if (m.kind === "answer") {
                  const t = ownTopic(m.topic);
                  return (
                    <div key={m.id} className="bub bot ans">
                      <b>{t.q}</b>
                      {t.a.length > 1 ? <ol>{t.a.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p>{t.a[0]}</p>}
                      {m.topic.link && m.topic.link.href !== path && (
                        <Link href={m.topic.link.href} className="btn sm mt-1 self-start" onClick={() => box.current?.close()}>{m.topic.link.label} ›</Link>
                      )}
                      {m.others.length > 0 && (
                        <div className="ans-more">
                          <span>{w.other}</span>
                          {m.others.map((o) => <button key={o.id} type="button" className="link text-left" onClick={() => pickTopic(o)}>{ownTopic(o).q}</button>)}
                        </div>
                      )}
                      {!m.rated && (
                        <div className="ans-rate">
                          <span>{w.helped}</span>
                          <button type="button" className="btn sm" onClick={() => rate(m, true)}>👍 {w.yes}</button>
                          <button type="button" className="btn sm" onClick={() => rate(m, false)}>👎 {w.no}</button>
                        </div>
                      )}
                    </div>
                  );
                }
                if (m.kind === "check") return (
                  <div key={m.id} className="bub bot ans">
                    {m.check ? (
                      <>
                        <b>{m.check.title}</b>
                        <ul className="help-check">
                          {m.check.items.map((it, i) => <li key={i} className={it.ok ? "ok" : "todo"}>{it.text}</li>)}
                        </ul>
                        <div className="mt-1"><button type="button" className="btn sm" onClick={() => compose("problem")}>{w.sendAsNote(owner)}</button></div>
                      </>
                    ) : <p>{w.checkFail}</p>}
                  </div>
                );
                if (m.kind === "text") return (
                  <div key={m.id} className="bub bot">
                    {m.text}
                    {m.offer && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className="btn primary sm" onClick={() => compose(m.offer!.kind, m.offer!.body)}>{w.sendAsNote(owner)}</button>
                        {m.guide && <button type="button" className="btn sm" onClick={() => pickTopic(m.guide!)}>{lang === "hi" && m.guide.hi ? m.guide.hi.q : m.guide.q}</button>}
                      </div>
                    )}
                  </div>
                );
                return <Compose key={m.id} w={w} owner={owner} lang={lang} kind={m.note} body={m.body} files={m.files} done={!!m.done} page={path} pageName={here} folder={`${companyId}/help/${userId}`}
                  onSent={(no) => { patch(m.id, { done: true }); push({ from: "bot", kind: "text", text: w.sent(no, owner) }); router.refresh(); }}
                  onCancel={() => patch(m.id, { done: true })} />;
              })}
            </div>
            {staged.length > 0 && (
              <div className="help-staged">
                {staged.map((f, i) => (
                  <button key={i} type="button" className="chip" aria-label={`${w.removePhoto} ${f.name}`} onClick={() => setStaged((all) => all.filter((_, j) => j !== i))}>
                    {fileIcon(f.type, f.name)} {f.name.length > 16 ? `${f.name.slice(0, 13)}…` : f.name} ✕
                  </button>
                ))}
                <span className="compose-hint">{w.stagedHint}</span>
              </div>
            )}
            <form className="help-bar" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
              <label className="btn help-attach" title={w.attachTitle}>
                <input type="file" accept={ATTACH_ACCEPT} multiple className="sr-only" aria-label={w.attachTitle}
                  onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; attach(picked); }} />
                <svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m16.5 9.5-6.4 6.4a4 4 0 0 1-5.7-5.7l6.7-6.7a2.7 2.7 0 0 1 3.8 3.8l-6.6 6.6a1.3 1.3 0 0 1-1.9-1.9l6-6" />
                </svg>
              </label>
              <textarea ref={input} className="inp" rows={1} value={text} placeholder={staged.length ? w.stagedPlaceholder : w.placeholder} aria-label={w.placeholder} maxLength={500}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => { const f = pastedFiles(e); if (f.length) { e.preventDefault(); attach(f); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text); } }} />
              <button className="btn primary help-send" disabled={!text.trim()} aria-label={w.send}>
                <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M10 16V4m0 0-5 5m5-5 5 5" />
                </svg>
              </button>
            </form>
          </>
        ) : (
          <div className="help-log">
            {notesError && <div className="errbox">{notesError}</div>}
            {notes === null ? <p className="muted p-2 text-[13.5px]">…</p> : notes.length === 0 ? (
              <div className="empty"><b>{w.empty}</b>{w.emptySub}</div>
            ) : notes.map((n) => <NoteCard key={n.id} n={n} w={w} lang={lang} />)}
            {role === "owner" && (
              <Link href="/feedback" className="btn mt-1" onClick={() => box.current?.close()}>{w.seeAll} ›</Link>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}

type Words = (typeof T)["en"] | (typeof T)["hi"];

// The note form inside the chat: what kind, what happened, attachments, and the screen it came from.
function Compose({ w, owner, lang, kind: first, body: firstBody, files: firstFiles, done, page, pageName, folder, onSent, onCancel }: {
  w: Words; owner: string; lang: Lang; kind: NoteKind; body: string; files?: File[]; done: boolean; page: string; pageName: string; folder: string;
  onSent: (no: number) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<NoteKind>(first);
  const [body, setBody] = useState(firstBody);
  const [files, setFiles] = useState<File[]>(firstFiles ?? []);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [where] = useState(() => {
    if (typeof document === "undefined") return pageName;
    const h = document.querySelector("main h1")?.textContent?.trim();
    return h && h !== pageName ? `${pageName} · ${h.slice(0, 80)}` : pageName;
  });
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!done) area.current?.focus({ preventScroll: true }); }, [done]);

  function send() {
    setError("");
    start(async () => {
      try {
        const photos = files.length ? await uploadAttachments(folder, files) : [];
        const res = await sendNote({ kind, body, page, pageTitle: where, photos });
        if (res.error) return setError(res.error);
        toast(lang === "hi" ? "भेज दिया" : `Sent to ${owner}`);
        onSent(res.no!);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (done) return (
    <div className="bub bot note-sent">
      <span className="chip">{w.kinds[kind]}</span> {body || "…"}
    </div>
  );
  return (
    <div className="compose">
      <div className="seg w-full" role="group" aria-label="Kind">
        {(["problem", "wrong_data", "idea", "question"] as NoteKind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{w.kinds[k]}</button>
        ))}
      </div>
      <textarea ref={area} className="inp" rows={4} value={body} maxLength={4000} placeholder={w.prompts[kind]} aria-label={w.prompts[kind]}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e) => { const f = pastedFiles(e); if (f.length) { e.preventDefault(); setFiles((all) => [...all, ...f].slice(0, 4)); } }} />
      <div className="compose-meta">
        <label className="btn sm">
          <input type="file" accept={ATTACH_ACCEPT} multiple className="sr-only" disabled={files.length >= 4}
            onChange={(e) => {
              // Read the picked files now: clearing the input below empties e.target.files before React runs the updater.
              const picked = Array.from(e.target.files ?? []);
              setFiles((f) => [...f, ...picked].slice(0, 4));
              e.target.value = "";
            }} />
          📎 {w.photo}
        </label>
        {files.length > 0 && (
          <span className="compose-files">
            {files.map((f, i) => (
              <button key={i} type="button" className="chip" aria-label={`${w.removePhoto} ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                {fileIcon(f.type, f.name)} {f.name.length > 16 ? `${f.name.slice(0, 13)}…` : f.name} ✕
              </button>
            ))}
          </span>
        )}
        {files.length === 0 && <span className="compose-hint">{w.attachHint}</span>}
        <span className="compose-where">{w.from}: {where}</span>
      </div>
      {error && <div className="errbox">{error}</div>}
      <div className="row">
        <button type="button" className="btn primary grow" disabled={pending || body.trim().length < 2} onClick={send}>{pending ? w.sending : w.sendTo(owner)}</button>
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>{w.cancel}</button>
      </div>
    </div>
  );
}

// Screenshots pasted with Ctrl+V / long-press arrive as files on the clipboard.
function pastedFiles(e: React.ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.files ?? []);
}

const dm = (t: string, lang: Lang) => new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(t));
export const STATUS_TONE: Record<TeamNote["status"], string> = { new: "", planned: "info", later: "warn", done: "ok", declined: "bad" };

function NoteCard({ n, w, lang }: { n: TeamNote; w: Words; lang: Lang }) {
  return (
    <article className={`note${!n.seen ? " unseen" : ""}`}>
      <div className="note-h">
        <span className="chip">{w.kinds[n.kind]}</span>
        <span className={`chip ${STATUS_TONE[n.status]}`}>{w.status[n.status]}</span>
        <span className="note-when">#{n.no} · {dm(n.created_at, lang)}</span>
      </div>
      <p className="note-body">{n.body}</p>
      <NoteFiles files={n.files} label={`note ${n.no}`} />
      {n.page_title && <p className="note-where">{n.page && n.page.startsWith("/") ? <Link href={n.page} className="link">{n.page_title}</Link> : n.page_title}</p>}
      {n.reply && (
        <div className="note-reply">
          <span>{w.replied(n.replied_by ?? "Sourcingo")}{n.replied_at ? ` · ${dm(n.replied_at, lang)}` : ""}</span>
          <p>{n.reply}</p>
        </div>
      )}
    </article>
  );
}

function fileIcon(type: string, name: string) {
  return type.startsWith("image/") ? "🖼" : type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(name) ? "🎬" : "📄";
}

// A note's attachments: photos as thumbnails, videos playable in place, other files as named links.
export function NoteFiles({ files, label }: { files?: NoteFile[]; label: string }) {
  if (!files?.length) return null;
  const media = files.filter((f) => f.kind !== "file");
  const docs = files.filter((f) => f.kind === "file");
  return (
    <>
      {media.length > 0 && (
        <div className="note-photos">
          {media.map((f, i) => f.kind === "video" ? (
            <video key={i} src={`${f.url}#t=0.1`} controls playsInline preload="metadata" aria-label={`Video ${f.name}, ${label}`} />
          ) : (
            <a key={i} href={f.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={`Photo ${i + 1} of ${label}`} />
            </a>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="note-docs">
          {docs.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer" className="note-doc">
              <span aria-hidden>📄</span><span className="truncate">{f.name}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

// Help in the factory and buyer pages' top bar.
export function HelpPill({ label, unseen = 0 }: { label: string; unseen?: number }) {
  return (
    <button type="button" className="help-pill" onClick={() => openHelp(unseen ? "notes" : "ask")} aria-label={unseen ? `${label}, ${unseen} new` : label}>
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM7.9 7.6a2.2 2.2 0 0 1 4.25.8c0 1.5-2.15 1.9-2.15 3.1M10 14.2v.05" />
      </svg>
      {label}
      {unseen > 0 && <span className="tab-badge">{unseen}</span>}
    </button>
  );
}
