// What we make, one page each on the public website (/make/<slug>). Plain, true trade words: what it is, how it is
// made here, what to send us. No minimums or lead times promised: those come with each costing.

export type SiteProduct = {
  slug: string; name: string; title: string; description: string; lede: string;
  makes: string[]; craft: string[]; send: string[]; faq: { q: string; a: string }[]; ask: string;
};

export const SITE_PRODUCTS: SiteProduct[] = [
  {
    slug: "kurtas", name: "Kurtas and kurta sets", ask: "Kurta set",
    title: "Kurta and kurta set manufacturer in Jaipur, India",
    description: "Kurtas, kurtis and kurta sets made in Jaipur for brands and boutiques: block print, screen print, embroidery, with dated production and our own QC.",
    lede: "Straight, A-line, anarkali and short kurtas, alone or as sets with pants, palazzos and dupattas, made by Jaipur units that do this every day.",
    makes: ["Kurtas and kurtis in every length and silhouette", "Kurta sets with pants, palazzos or sharara", "Dupattas and stoles to match", "Size sets, plus sizes and kids' sizes on request"],
    craft: ["Hand block print and Dabu (mud-resist) print", "Screen and digital print", "Hand and machine embroidery, gota and mirror work", "Cotton, cambric, mulmul, rayon, linen blends, chanderi"],
    send: ["A sample or photos of the style", "Size chart and measurements", "Fabric and print choices, with colourways", "Labels, tags and packing you need"],
    faq: [
      { q: "Can you match a kurta from my sample?", a: "Yes. Send the sample to our Jaipur office and we cost it piece by piece, then make a counter sample for your approval before production." },
      { q: "Do you make sets as one order?", a: "Yes. Each piece of a set is its own style on the order, with its own plan and checks, and they ship together." },
    ],
  },
  {
    slug: "co-ord-sets", name: "Co-ord sets", ask: "Co-ord set",
    title: "Co-ord set manufacturer in India: linen, cotton and printed co-ords",
    description: "Matching tops and bottoms made in Jaipur: linen, cotton and printed co-ord sets for resort, lounge and everyday ranges, with verified photos at every step.",
    lede: "Matching shirts, tops, shorts, pants and skirts, cut from the same fabric lot so the colours match piece to piece.",
    makes: ["Shirt and trouser co-ords", "Crop top and skirt or short sets", "Lounge and resort co-ords", "Printed and solid-dyed sets"],
    craft: ["Linen, cotton, cotton-linen, rayon and satin", "Block, screen and digital prints", "Garment dye and enzyme wash", "Coconut shell, wood and fabric-covered buttons"],
    send: ["Photos or a sample of each piece", "Size chart for top and bottom", "Fabric weight and composition you want", "Colourways and quantity per colour"],
    faq: [
      { q: "How do you keep the top and bottom the same shade?", a: "Both pieces are cut from the same fabric lot, and our inline check compares them side by side before stitching goes on." },
      { q: "Can I order different sizes for top and bottom?", a: "Yes. Each piece has its own size split on the order." },
    ],
  },
  {
    slug: "kaftans", name: "Kaftans and resort wear", ask: "Kaftan",
    title: "Kaftan and resort wear manufacturer in Jaipur, India",
    description: "Block-printed and digitally printed kaftans, beach cover-ups and resort dresses made in Jaipur, checked by our own QC team before they ship.",
    lede: "Long and short kaftans, cover-ups and resort dresses, in the hand block prints Jaipur is known for or in your own prints.",
    makes: ["Long, midi and short kaftans", "Beach cover-ups and sarongs", "Resort dresses and tunics", "Robes and loungewear"],
    craft: ["Hand block print on cotton and voile", "Rayon, viscose crepe, georgette and silk blends", "Tassels, lace, tie-ups and hand embroidery", "Pom-poms and trims made to match"],
    send: ["A sample or flat sketch with length", "Print artwork, or pick from our printers' blocks", "Fabric and trim choices", "Quantity per print and colour"],
    faq: [
      { q: "Can I use my own print?", a: "Yes. Send the artwork; for block print we have blocks carved, for screen or digital print we make screens or files, and we send a strike-off for approval." },
      { q: "Are block prints all exactly the same?", a: "Hand block print has small, natural variation. That is part of the craft; we check that every piece stays within your approved sample." },
    ],
  },
  {
    slug: "dresses-and-tops", name: "Dresses and tops", ask: "Dress",
    title: "Women's dresses and tops manufacturer in India",
    description: "Dresses, tops, shirts and blouses made in Jaipur for brands and boutiques, with dated production plans, step photos and final inspection.",
    lede: "Everyday and occasion dresses, tops, shirts and blouses, made to your fit and finished to your standard.",
    makes: ["Maxi, midi and mini dresses", "Shirts, blouses and tunics", "Tiered, smocked and shirred styles", "Nightwear and pyjama sets"],
    craft: ["Cotton poplin, voile, mulmul, linen and rayon", "Smocking, shirring, pin tucks and lace inserts", "Embroidery and schiffli", "Prints from block to digital"],
    send: ["A sample or tech pack", "Your fit and grading", "Fabric and trims", "Labels, hang tags and packing spec"],
    faq: [
      { q: "Do you work from a tech pack?", a: "Yes. A tech pack with measurements and a sample, or a reference garment, are both good starting points." },
      { q: "What gets checked before shipping?", a: "Our quality team does a final inspection on finished, packed pieces: measurements, workmanship and finishing, with defects counted and photographed." },
    ],
  },
  {
    slug: "printed-fabric", name: "Block-print and hand-printed fabric", ask: "Printed fabric by the metre",
    title: "Block-print and hand-printed fabric supplier, Jaipur and Sanganer",
    description: "Hand block-printed, Dabu, screen-printed and dyed fabric by the metre from Jaipur and Sanganer, with strike-offs and lot checks.",
    lede: "Fabric by the metre from the printing tables of Sanganer and Bagru: hand block, Dabu, screen print and solid dyes.",
    makes: ["Hand block print, Dabu and Bagru prints", "Screen and digital print", "Solid and tie-dye", "Cotton, mulmul, cambric, linen, rayon and voile bases"],
    craft: ["Strike-off for every print and colour before bulk", "Lot checks for shade, print fit and defects", "Rolled or folded, with metres per roll recorded", "Your prints, or the printers' own blocks"],
    send: ["The print artwork or a swatch", "Base fabric and width", "Metres per colourway", "How you want it rolled and packed"],
    faq: [
      { q: "Do you sell fabric by the metre?", a: "Yes. Fabric orders are counted in metres, with their own shorter plan: base fabric, strike-off, printing, washing, checking and packing." },
      { q: "Can I see the print before bulk?", a: "Always. We send a strike-off of each print and colour for your approval before bulk printing starts." },
    ],
  },
  {
    slug: "private-label", name: "Private label for brands and boutiques", ask: "Private label range",
    title: "Private label clothing manufacturer in India for brands and boutiques",
    description: "Private label garments from Jaipur with your labels, tags and packing: costing on your exact style, a live order page and our own quality checks.",
    lede: "Your designs, your labels, your packing. We cost, make, check and ship it, and you watch it on your own order page.",
    makes: ["Capsule collections across kurtas, co-ords, kaftans and dresses", "Repeat styles reordered from your past orders", "Woven labels, care labels, hang tags and swing tickets", "Polybags, hangers and cartons to your spec"],
    craft: ["A costing for each exact style, in writing", "A dated plan for every style against your ship date", "Photos at each step, checked by our team", "Final inspection before packing"],
    send: ["Your styles: samples, tech packs or photos", "Label and packing spec", "Size split per style and colour", "Your ship date"],
    faq: [
      { q: "Will my labels be used?", a: "Yes. Send your label and tag artwork, or we can have them made locally for your approval." },
      { q: "Can I reorder a style later?", a: "Yes. Every style we have made for you stays on record with its costing, fabric and fit, so a reorder starts from what worked." },
    ],
  },
];

export const siteProduct = (slug: string) => SITE_PRODUCTS.find((p) => p.slug === slug);
