// The public website: its address, its pages, and the words they share. Visitors read these without signing in.

// The address search engines and shared links use. Set NEXT_PUBLIC_SITE_URL when the site moves to its own domain.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sourcingo-os.vercel.app").replace(/\/$/, "");

// Pages anyone may open without signing in ("/" itself shows /welcome to visitors).
export const SITE_PATHS = ["/welcome", "/how-it-works", "/quality", "/for-factories", "/costing", "/privacy", "/make", "/record", "/sitemap.xml", "/robots.txt", "/opengraph-image"];

export const SITE_NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/quality", label: "Quality" },
  { href: "/for-factories", label: "For factories" },
];

// The pages a search engine should know about, most important first.
export const SITE_PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/how-it-works", priority: 0.9 },
  { path: "/quality", priority: 0.8 },
  { path: "/costing", priority: 0.9 },
  { path: "/for-factories", priority: 0.7 },
  { path: "/make/kurtas", priority: 0.8 },
  { path: "/make/co-ord-sets", priority: 0.8 },
  { path: "/make/kaftans", priority: 0.8 },
  { path: "/make/dresses-and-tops", priority: 0.8 },
  { path: "/make/printed-fabric", priority: 0.8 },
  { path: "/make/private-label", priority: 0.8 },
  { path: "/privacy", priority: 0.2 },
];

// The six stages every order moves through, as a buyer would put them. Same order as journey() in the app.
export const SITE_STAGES = [
  { key: "Costing", title: "A price for your exact style", text: "Send your sample, tech pack or photos. A merchandiser costs it with you and gives a price per piece and a ready date." },
  { key: "Factory", title: "The right factory for it", text: "Checked factories quote on your exact style. We pick on their record with us: on time, first-time QC pass, defects." },
  { key: "Plan", title: "Every step dated", text: "Fabric, cutting, stitching, finishing, packing: each step gets a date that works back from your ship date." },
  { key: "Make", title: "Made, with photos", text: "The factory posts photos at each step. Our team checks them before you see them, so every picture is verified." },
  { key: "Final QC", title: "Checked before it leaves", text: "Our own quality team inspects inline, mid-line and before packing. Nothing ships on a failed final check." },
  { key: "Ship", title: "Packed and shipped", text: "Packed to your carton and label spec, with packing list and invoice, handed to your forwarder or freight." },
];


// Countries buyers most often write from, offered first; anything else can be typed.
export const SITE_COUNTRIES = [
  "United States", "United Kingdom", "Australia", "Canada", "Germany", "France", "Netherlands", "Spain", "Italy", "Sweden",
  "United Arab Emirates", "Saudi Arabia", "Japan", "Singapore", "New Zealand", "South Africa", "India",
];

