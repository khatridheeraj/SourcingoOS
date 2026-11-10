// Team notes on an order: the longest note, and who a note tags.
export const NOTE_MAX = 2000;
export const NOTE_PHOTOS = 6;

export type Person = { id: string; name: string };

// The first word of a name, as people tag each other: "@Vidhi" for Vidhi Khandelwal.
export const handle = (name: string) => name.trim().split(/\s+/)[0] ?? "";

// Everyone tagged: the people picked on the chips, plus anyone written as @Name in the text (any case).
export function tagged(body: string, picked: string[], team: Person[]): string[] {
  const words = new Set([...body.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((m) => m[1].toLowerCase().replace(/[.,!?:;]+$/, "")));
  const typed = team.filter((p) => handle(p.name) && words.has(handle(p.name).toLowerCase())).map((p) => p.id);
  return [...new Set([...picked, ...typed])];
}

// The note's text in pieces, with each @Name of a teammate marked so it can be shown as a tag.
export function pieces(body: string, team: Person[]): { text: string; tag: boolean }[] {
  const names = new Set(team.map((p) => handle(p.name).toLowerCase()).filter(Boolean));
  return body.split(/(@[\p{L}\p{N}_.-]+)/u).filter(Boolean)
    .map((text) => ({ text, tag: text.startsWith("@") && names.has(text.slice(1).toLowerCase().replace(/[.,!?:;]+$/, "")) }));
}
