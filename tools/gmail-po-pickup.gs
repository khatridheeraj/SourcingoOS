/**
 * Sourcingo OS: picks up buyer POs from this Gmail mailbox.
 *
 * Every 10 minutes it looks at emails from the last 3 days that have a PDF, Excel, CSV or photo attached,
 * and hands each new one to the app (Incoming POs). The app's AI reads it and sets aside anything that isn't
 * a buyer PO, so nothing needs sorting here. Nothing is ever sent, changed or deleted in the mailbox, except
 * a "Sourcingo OS/Picked up" label on emails it handed over.
 *
 * Set up once: paste this into a new project at script.google.com while signed in to the mailbox,
 * put the key in KEY, run setUp, and allow access when Google asks.
 */
const APP = "https://sourcingo-os.vercel.app";
const KEY = "PASTE_THE_KEY_HERE";
const TYPES = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", csv: "text/csv",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const MIN_PHOTO = 30 * 1024; // smaller pictures are logos and signatures

function setUp() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("pickUpPos").timeBased().everyMinutes(10).create();
  pickUpPos();
}

function pickUpPos() {
  const label = GmailApp.getUserLabelByName("Sourcingo OS/Picked up") || GmailApp.createLabel("Sourcingo OS/Picked up");
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty("seen") || "[]");
  const threads = GmailApp.search("has:attachment newer_than:3d -in:spam -in:trash -in:chats", 0, 50);
  for (const thread of threads) {
    let handed = false;
    for (const msg of thread.getMessages()) {
      const id = msg.getId();
      if (seen.indexOf(id) >= 0 || msg.isDraft()) continue;
      try {
        if (handOver(msg)) handed = true;
        seen.push(id);
      } catch (err) {
        console.error("Couldn't hand over " + msg.getSubject() + ": " + err); // tried again next run
      }
    }
    if (handed) thread.addLabel(label);
  }
  props.setProperty("seen", JSON.stringify(seen.slice(-350)));
}

function handOver(msg) {
  const files = msg.getAttachments({ includeInlineImages: false }).filter((a) => {
    const ext = a.getName().split(".").pop().toLowerCase();
    return TYPES[ext] && !(TYPES[ext].indexOf("image/") === 0 && a.getSize() < MIN_PHOTO);
  });
  if (!files.length) return false;
  const start = post("/api/inbound-po", {
    key: KEY,
    email: { email_id: msg.getId(), from: msg.getFrom(), subject: msg.getSubject(), body: msg.getPlainBody().slice(0, 8000),
             received_at: msg.getDate().toISOString() },
    files: files.map((a) => ({ name: a.getName(), size: a.getSize() })),
  });
  if (!start.uploads) return !!start.duplicate;
  const used = [];
  for (const u of start.uploads) {
    const i = files.findIndex((a, n) => used.indexOf(n) < 0 && a.getName().slice(0, 200) === u.name);
    used.push(i);
    const res = UrlFetchApp.fetch(u.url, { method: "put", contentType: u.type, payload: files[i].getBytes(), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) throw new Error("upload failed: " + res.getContentText());
  }
  post("/api/inbound-po/ready", { key: KEY, id: start.id });
  return true;
}

function post(path, body) {
  const res = UrlFetchApp.fetch(APP + path, { method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText() || "{}");
  if (res.getResponseCode() >= 300) throw new Error(data.error || res.getContentText());
  return data;
}
