// Digits typed on an Indian-language keyboard or pasted from a Hindi WhatsApp message ("१,२००", "૩૦૦") read as
// the same numbers as 0-9, so a number box never silently drops them or refuses them. Covers Devanagari, Bengali,
// Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam digits (each script's 0-9 sit 0x80 apart), and
// the full-width ０-９ some keyboards send.
const INDIC = /[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯０-９]/g;

export function latinDigits(s: string): string {
  return s.replace(INDIC, (c) => {
    const cp = c.codePointAt(0)!;
    return String(cp >= 0xff10 ? cp - 0xff10 : (cp - 0x0966) & 0x7f);
  });
}

// Only the digits 0-9 of what was typed, for whole-number boxes (days, pieces, buffer).
export const wholeText = (s: string) => latinDigits(s).replace(/\D/g, "");
