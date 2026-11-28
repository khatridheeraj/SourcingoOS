# Sourcingo design rules

These rules keep every screen consistent. Every change follows them, including the hourly check-and-fix runs.

## One idea per screen
- **Home** answers "what needs me today". The day header with its ring comes first, then one To do queue, ordered red first.
  The queue holds one block per order: the order's name once, then each job as one line with its own small button.
  Nothing else goes on Home but Your approvals for the owner, money for the owner and Accounts, and the Tidy up list;
  overviews live on Orders and Reports.
- **Your approvals** (owner only, above To do) holds everything only the owner can clear: factory POs sent for approval and
  emails from unknown senders. Each line says what it is, who asked and how long it has waited, with Approve and Send back
  right there. These never also show in To do. The Home menu item counts them.
- A note that tags me (order Notes tab) is a To do line in its order's block, amber, with Reply, until I reply on that order or tap Done.
- **Weekly buyer updates** (Buyers > Weekly updates): every buyer with an open order hears from us once a week. Built by
  `buyerWeek()` in `src/lib/buyer-week.ts` from what the buyer's own page shows, never more. Home keeps one line in This week
  until all are sent; a PO past its ship date says "N days past the ship date" in red on the buyer's page and in the update, until a new date is set; the buyer's page opens with "What moved this week" (only POs where something moved).
- **Your styles** (buyer page, after its POs): every style the buyer ordered, one row per style and colour, with approved samples
  and final QC. Order again becomes an inquiry (`buyer_reorder`, `inquiries.reorder_of`) due today for that order's merchandiser.
- **Add POs from a sheet** (Orders > Add from a sheet): pasted rows or a CSV become one order per buyer and PO, read by
  `readSheet()` in `src/lib/po-sheet.ts`; every problem names its row, and only clean POs are added, each through `saveOrder`.
- **A lead's own page**: an open inquiry from someone not yet a buyer has "Make their page" (`make_buyer_from_inquiry`), which
  adds the buyer, gives the asker a person link, and moves the ask onto their buyer page.
- **Calendar** (a tab beside To do) answers "what is coming". One block per day that has something on it; late work stays on To do.
- Red means the ship date will be missed. A step past its target while the ship date still holds is amber ("needs an update").
- **Orders** answers "where is everything". On a computer it is a board with one column per stage; on a phone it is a list of cards.
- **An order** answers "where is this order, and what do I do next". The hero, then the journey card with one next step, then one work area at a time.

## One source of truth for an order's state
- The stage (Factory, Plan, PO, Make, Final QC, Ship) and the single next step come from `journey()` in `src/lib/journey.ts`.
  Never work out "what's next" again on a screen: add the rule to `journey()` and to `journey.test.ts`.
- Days to ship come from `shipClock()`, and the order-page area a stage opens comes from `areaOf()`, both in the same file.
- **Style by style** (`src/lib/style-track.ts`): each style gets its own stage and next step from `journey()` run on that style
  alone, so a style waiting for a factory never holds back styles already being made. `orderFromStyles()` gives the order its one
  next step: the order's own when red, else a style that is behind. A style may ship on its own date (`order_lines.ship_date`,
  empty = the PO's); its plan works back from it. Orders has three tabs: By order, By style (`/orders/styles`), By factory
  (`/orders/factories`), all drawn with `StyleRows` (`src/components/style-rows.tsx`).
- **A step marked done carries photos of the work.** The factory's updates and Quality's visits always did; the team's done dates
  now go through `mark_steps_done` with photos in the style's folder (`step_proofs`), which the buyer sees beside the factory's.
  Final QC is exempt: its check has its own photos.
- **Factory details and papers** (`supabase/migrations/0135_factory_kyc.sql`): `factory_gaps()` alone decides what a factory still
  owes and "Ready for POs"; a factory PO can't be sent for approval or released until it is empty. Add factory takes every detail;
  the factory page and the factory's own panel show `FactoryKycCard`, and Ask the factory sends its link with the missing list.
- **E-way bill only when the law asks** (`docs/EWAY-BILL.md`): the database clears a lot's e-way bill step when its invoice with
  GST is not above the limit for where it goes (`dispatch_eway_rule`, limits in `companies.eway_rules`, owner edits them on Goods).
  Screens explain it with `src/lib/eway.ts` and never decide it again.

## Who sees what
- `docs/ACCESS.md` is the access table, and the database holds every line of it (row-level security and guarded functions).
- Anything about buyers (real names, contacts, messages, buyer emails, inquiries, selling prices, Dispatch) needs the
  **Buyer details** switch: `can(me, "buyers")` on screen, `can_see_buyers()` in the database. Without it a buyer shows
  by its code. A new screen or function about buyers follows both, and the access table gets the new line.

## Shared building blocks (`src/components/order-ui.tsx`)
- `ShipClock`: days to ship as one big number (`lg` on the order page, `sm` on cards).
- `StageMeter`: six short bars, one per stage, coloured by the next step's tone.
- `PhotoStack`: style photos, shown only when at least one exists.
- `Ring`: progress that fills as work gets done.
- `PhotoViewer` (`src/components/photo-viewer.tsx`, mounted once in the root layout): every photo opens in a pop-up on the
  same page, never a new tab. A link to a picture or an `<img data-zoom>` opens it by itself; wrap a set in `data-photos`
  to swipe through them and give each a `data-caption` (style, step, date, who). `data-no-zoom` opts out.
Use these instead of drawing a new version on a screen. A new pattern that more than one screen needs goes here first.

## Look
- Neutral greys carry the interface. Indigo (`--accent`) marks what you can act on. Red, amber and green only ever mean late,
  needs attention, and done. No other colours.
- Colours come from the tokens at the top of `src/app/globals.css`, so dark mode works by itself. Never write a raw colour in a component.
- Type: Inter. Page titles 30px (25px on a phone), section titles 16px, body 14px, details 12 to 13px. Numbers use `num` (tabular).
- One primary button per area. Everything else is a plain button or a link.
- Show a chip only when it tells someone something they need now (late, at risk, waiting on them). No "not done yet" chips.
- Help text lives in a closed `<details>` at the end of its section, never above the work.

## Phone first
- Every screen is checked at 390px wide. Primary buttons are full width and at least 44px tall.
- Nothing scrolls sideways except the tab bars.

## Before shipping any screen change
1. `node e2e/shot.mjs <role> <path> /tmp/x --screens 2`, again with `--desk`, and once with `--dark`. Look at every image.
2. Ask: is the next step obvious? Is there anything here nobody needs right now? Would it look at home in Linear or Stripe?
3. `e2e/run.sh` must report no problems.

## Public website (`src/app/(site)`)
- sourcingo.in (a separate site, not in this repo) is Sourcingo's public face; Dheeraj chose to keep it (28 Nov 2026).
  These pages are for links from there and are never indexed: `robots.ts` disallows everything, the sitemap is empty.
- Visitors who aren't signed in get the website at `/` (the proxy shows `/welcome`); the team still gets Orders there.
  Pages: home, How it works, Quality, For factories, Request a costing, Privacy, and one page per product (`/make/<slug>`,
  content in `src/lib/site-products.ts`). Their paths are listed in `src/lib/site.ts`.
- Same tokens and Inter as the app, on a reading scale: display 58/48/40px (38/34/29 on a phone), lede 19px, body 16px.
- Photos: only real ones, from `public/site` through `Photo` in `parts.tsx` (WebP, about 1200px wide). Never a photo that shows a factory name, sign or logo, and never another brand's product shoot.
  Styles live in `src/app/(site)/site.css` and are prefixed `site-`. The block-print motif (`PrintPattern`) is the only decoration.
- Every claim is true today. No made-up numbers, customers or testimonials. Buyers never see factory names.
  The Guarantee shows only when the owner has switched it on (`site_facts()`). So does Our record (`/record`, PDF at
  `/record/pdf`): only `kitStats()` from `src/lib/record.ts`, never a number typed in or a rate on too few cases.
- The two forms call `site_ask_costing` and `site_join_factory`: a costing ask becomes an inquiry due today (Home, Inquiries,
  morning brief); a factory ask waits on Factories > Asked to join and on Home.
