// Sizes in the order people read them: XS before S before M, 28 before 30, then anything else as entered.
const LETTERS = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL", "6XL"];

const rank = (s: string) => {
  const i = LETTERS.indexOf(s.toUpperCase());
  if (i >= 0) return i;
  const n = Number(s);
  return Number.isFinite(n) ? 100 + n : 10_000;
};

// The database keeps sizes as an object, which doesn't keep their order; this puts them back in size order.
export const sizeEntries = (sizes: Record<string, number> | null | undefined): [string, number][] =>
  Object.entries(sizes ?? {}).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
