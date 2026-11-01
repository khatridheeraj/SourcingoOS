# Found ledger

The memory of every check-and-fix run (see `e2e/HOURLY.md`). Read it first, every run, and update it last.
Dheeraj's rule (29 Oct 2026): an audit must never find or report the same thing twice. Each run hunts for
something new, and a thread that only repeats an old ask must not exist.

How to use it:
- **Known** below is everything already found. Never report an item that is already here. If it still happens,
  bump its "last seen" date in this file and say nothing.
- **Needs Dheeraj**: each item is reported to him once, in the run that first finds it. After that it stays
  here silently until he answers or it is fixed. Never ask him again, never open a thread about it.
- **Coverage**: which area was looked at from which angle, and when. Each run picks what has not been looked
  at, or was looked at longest ago, and adds a line.
- Keep it short: one line per item. Move an item to **Closed** when it is fixed or answered (with the PR or date).

## Needs Dheeraj (already reported, do not report again)
| Item | First reported | Last seen |
|---|---|---|
| Buyer status page after the ship date has passed: say "N days past" or stay quiet? | 2026-10-26 | 2026-10-29 |
| Nightly database backup needs a GitHub secret from him | 2026-10-24 | 2026-10-29 |
| One buyer PO in "To check" and one held, both over 2 days old (live data, team's job). 29 Oct 17:00Z: only the held one is left; 31 Oct: 4 held (unknown senders, in Your approvals); 1 Nov: 3 held, evening 4 | 2026-10-29 | 2026-11-01 |
| Live order SO-0004 is still open 31 days after its 30 Sep ship date: mark it shipped, close it short, or set a new ship date (team's job) | 2026-10-31 | 2026-11-01 |

## Known (not new, never report)
| Item | Why it is not a finding | Last seen |
|---|---|---|
| Crawl flags a page "slow" or ERR_CONNECTION_* on a cold or reloading dev server | Fast on reload; only a finding if it stays slow on recheck | 2026-10-29 |
| Second `e2e/run.sh` on a stack that is still running: crawl shows 404s everywhere (PostgREST keeps the dropped database's grants) | Stop ports 3100, 54321, 54322 (`fuser -k`) and run it again; not an app glitch | 2026-10-30 |
| Live Tally reader: last snapshot ~10 h old overnight while the PC agent is seen (30 Oct 14:00 IST: 18 h, Tally not opened yet that day) | Tally is closed after office hours; the agent still checks in | 2026-11-01 |
| Live Tally PC agent not seen for a day (31 Oct, Saturday evening: 25 h) | The office PC is off; only a finding if it stays unseen on a working day (1 Nov, Sunday: 33 h, evening 49 h) | 2026-11-01 |
| Postgres log errors whose query ends in `-- source: POST /mcp` | Come from the run's own checks, not the app | 2026-10-31 |
| Gmail pickup has found no new buyer PO for days | No buyer has emailed a PO; not a glitch (1 Nov evening: 50 h) | 2026-11-01 |
| Factory PO emails all go to merchandiser@sourcingo.in | Test inbox mode, on purpose until Dheeraj says switch | 2026-10-31 |
| Markers screen paused | MARKERS_ON flag, on purpose | 2026-10-31 |
| Supabase advisors: security-definer functions callable by anon/authenticated, RLS on with no policy, one mutable search_path, leaked-password check off | Long-standing by design (the app's RPCs are security definer and check the role inside); not new | 2026-11-01 |
| Supabase performance advisors: unindexed foreign keys, unused indexes, auth RLS initplan, multiple permissive policies, one table without a primary key | Long-standing INFO/WARN on a 33 MB database; nothing slow in the logs | 2026-10-31 |
| Morning brief "shipped in part" / "closed short" lines and Home's deleted-PO line say "pcs" even for a fabric order | The numbers come from database functions that don't return the unit; fix with the next migration a thread makes, not a check run | 2026-10-30 |
| Local stack: Next dev logs "The destination stream closed early" after a save that redirects | Dev-server noise when a page is left mid-stream; not seen in production | 2026-10-29 |
| Live auth log: "One-time token not found" on /verify (a sign-in link opened twice, or first by the mail app's link checker) | Someone already signed in now lands on the app instead of "expired" (2026-10-30 PR); a stray one is not a glitch | 2026-10-30 |
| Factory PO routine asking for database permission | He granted it on 2026-10-29 14:22Z. If a read or write is blocked, log it here and stay quiet | 2026-10-29 |

## Coverage
Areas: Home, Orders, order page (journey, styles, plan, factory PO, approval sheet), new order, Buyer POs,
Inquiries, Samples, Styles, Goods with us and challan, Payments (invoices, cheques, cash ahead), Bills to pay,
Reports, Brief, Today, Updates, Activity, Buyers, Factories, Team, Tally, Feedback, Help panel,
factory panel (/factory, /f/...), factory PO accept link (/po/...), buyer page (/buyer, /s/...), login.

Angles: phone light, phone dark, desk light, desk dark, each of the 7 roles (owner, manager, merch, quality,
accounts, factory, buyer), empty state (no orders, no styles, no photos), rush order (ships in 1 to 3 days),
order already late, large order (20+ styles, 50,000+ pieces, long names), fabric order (metres), part shipment,
Hindi or long text in names and notes, zero and huge money amounts, slow network (throttle in a short Playwright script) and double taps,
browser back after saving, phone Back with a sheet open, two people editing the same order, date edges (month end, year end, today vs
tomorrow), keyboard only, form errors (blank, wrong format, negative numbers), public links with a wrong or
made-up token (/po, /f, /s), print and PDF views (A4, many styles), printing from dark mode, a brand-new company with nothing in it, signed out / spent sign-in links, a very old order (a year past its ship date).

| Date | Area | Angle | Result |
|---|---|---|---|
| 2026-10-26 | Inquiries, Samples | phone light | Dates kept last year's year: fixed #187 |
| 2026-10-27 | Goods with us, Payments, Bills to pay, factory panel, buyer page | phone + desk light | Fine |
| 2026-10-28 | Order page | phone light | Step bars red while ship date held: fixed #188 |
| 2026-10-29 | Order page | phone light, 390px | Step date pickers cut the year: fixed #190 |
| 2026-10-29 | Home, Orders, Buyer POs | phone + desk light | Fine |
| 2026-10-29 | Help panel | all 7 roles | Opened unasked, wrong role content: fixed #193, #195; `e2e/help.mjs` guards it |
| 2026-10-29 | Factory visit (QC) | quality role, phone | Inline, Mid-line, Pass/Fail, Rejected, re-check: built #191, #192, #194, #198 |
| 2026-10-29 | Approval sheet, plan dates | merch + owner, phone | Plain-words blocker #199; own dates kept #200 |
| 2026-10-29 | New order | form errors (negative qty and rate, ship before PO date), double tap Create | Raw database error for ship before PO, "must be a number" for a negative rate: fixed (this run's PR). Double tap made one order, fine |
| 2026-10-29 | Start production | rush order (ships in 2 days), merch phone | Banner said "too close or past": now says how many days and the buffer (this run's PR) |
| 2026-10-29 | Public links /po, /f, /s | wrong and made-up tokens, phone light + dark (exploration) | /f and /s fine; /po bad link had no brand and no Hindi: fixed. Local stand-in answered any PO token, so /po/<uuid> crashed only locally: gateway now answers like live |
| 2026-10-30 | Order page, Orders, Styles, Reports, factory panel | large order (25 styles, 65,000 pcs, Rs 8 Cr) + Hindi and 130-character style names, phone + desk, light + dark | Order hero left a stray "·" when a long PO wrapped; catalogue showed "No step done yet" chips (DESIGN.md says no), shuffled one order's styles, and let long names flood the card; Reports "Which steps run late" showed red 0% that read as "0% late" on a phone. All fixed (this run's PR). Orders list, factory panel fine |
| 2026-10-30 | Factory PO print / PDF | 25 styles with long names, A4 (exploration: print view) | Design no. never wrapped, so Rate, Qty, Total, Colour and Image fell off the printed page: fixed (this run's PR). Hindi prints fine; the Total row repeats on every page, fine |

| 2026-10-30 | Goods with us, challan print, dispatch bill form, Margin, QC order details | fabric order (metres), phone + desk, light + dark | A fabric lot showed "2,000 pcs"; "Pieces with us" added metres to pieces; the printed challan headed the column "Pieces" with no unit; the bill form said "Pieces bought" and the margin table "Pieces"/"Per piece" for cambric. All fixed (this run's PR) |
| 2026-10-30 | Every screen with a date and time (Goods, dispatch, Today, QC, history, feedback, inquiries, factory panel, factory PO send) | date edges (September, last year's times) | Times were written "30 Sept" (dates elsewhere say "Sep") and dropped the year for last year's times: now one shared `dayTimeAt` (this run's PR) |
| 2026-10-30 | Challan number | slow network (1.5 s latency) + double tap, phone (exploration) | Second tap blocked while saving, one number given: fine |
| 2026-10-30 | Login and the email sign-in link | signed out deep link, link tapped twice, signed in visiting /login, typo in the email, phone light + dark (exploration: sign-in) | A signed-in person opening /login got the sign-in form again; a spent link showed "expired" even when already signed in; a link from a chat or email to an order dropped them on Home after signing in; a typo'd email had no way back but reload; Supabase's rate-limit wording shown raw. All fixed (this run's PR) |
| 2026-10-30 | Your approvals (Home, owner) | keyboard only, desk dark | Enter in "What should change?" did nothing and Escape didn't close it; after Approve, keyboard focus fell to the page top. Fixed (this run's PR): Enter sends back, Escape closes, focus moves to the approve question (not the button, so a second Enter can't approve) |
| 2026-10-31 | Every screen (Home, Orders, Styles, Reports, Brief, Activity, Team, Payments, Bills, Goods, Samples, Inquiries, Buyer POs, Buyers, Factories, Updates, Tally, Team notes) | empty state: a brand-new company with no orders, buyers or factories, owner phone | Factories "Work" told you to pick a factory on an order when none exist: now says add them in the Factory list first. Buyer POs "No file for a PO? Type it in" split into three columns: now one sentence. Brief help text sat open under the work: now a closed "How the brief works". The "page couldn't load" box ran its code into the sentence ("doing.Code"). All fixed (this run's PR). Other screens fine |
| 2026-10-31 | Order page Details | two tabs / two people saving the same order, phone | The older copy is refused with a plain message, fine. But the person whose save went through saw no "Saved" (the form reloads and drops it): now a "Order saved" toast (this run's PR) |
| 2026-10-31 | Brief, Reports, order page, Home, Payments | print / PDF from a phone or computer in dark mode (exploration) | Printed with the dark theme's near-white text on white paper (titles and rows faint grey), and the brief printed its tabs and WhatsApp/Copy buttons. Fixed (this run's PR): dark theme is screen-only, print always uses light ink; page tabs and the brief buttons don't print |
| 2026-10-31 | New order (and every screen's menu) | keyboard only, desk light + dark | Enter on Create with a look-alike PO left focus in the form while "Save anyway" appeared above, so Enter did nothing; "Add style" left focus on the button, not the new row; removing a style dropped focus; 15 menu stops before every page. Fixed (this run's PR): focus goes to Save anyway, to the new or next style, and a "Skip to content" link comes first |
| 2026-10-31 | Help notes, Activity log and its download, factory PO accept page (/po) | date edges (September, last year) | Three last places still formatted dates with Intl's short month: "10 Sept", and Help notes dropped last year's year. Now the shared format helpers, and a unit test fails if any file does it again (this run's PR) |
| 2026-10-31 | Every printed screen | print, primary buttons and coloured dots/badges (exploration: browser drops background fills) | White text on indigo/green/red printed blank. Fixed (this run's PR): print keeps fills |
| 2026-10-31 | Factory panel (Mark step done sheet), and every photo picker | keyboard only, desk light | Sheet opens, Escape closes and focus returns: fine. But Tab onto Camera / Gallery (and every other photo or file picker, 18 of them) showed no focus ring, because the real input is hidden. Fixed (this run's PR): the picker's box shows the ring |
| 2026-10-31 | Home, Orders, Styles, Goods, Reports, Samples, Inquiries, Buyer POs, Updates, Payments, Bills | empty state for merch, quality and accounts (a brand-new company) | Style catalogue showed search, two filters and a Show button over nothing, then "No styles found"; "clear the filters" was not a link. Fixed (this run's PR): no filters until there are styles, "No styles yet", clear link. Other screens fine |
| 2026-10-31 | Delete PO, new cheque, new invoice, edit inquiry | browser back after saving (exploration) | Back after deleting a PO opened a bare Next.js "404 This page could not be found"; any missing order, PO, invoice or wrong web address showed the same. Back after recording a cheque or invoice reopened an empty "new" form, and after editing an inquiry the edit form. Fixed (this run's PR): plain "This isn't here any more" page with Orders, Cancelled and Home; saves replace the spent form in history. No duplicate was possible (the reopened form is blank) |
| 2026-11-01 | Order page, Brief, Today, Orders | a very old order (ship date a year ago, part shipped), owner + merch phone (exploration: very old order) | The Brief said "ship date 28 Oct has passed, 369 days ago" with no year, and the next step "It was due 10 Sep" never said which year: nine screens wrote day and month by hand. Now they all use `dayNear` (adds the year for another year), a unit test fails if any file does it again, and journey.test checks an old due date (this run's PR). Orders list and ship clock already showed the year |
| 2026-11-01 | Order page next-step card | phone light + dark, owner and merch, three extra buttons (Update progress, Status link, Share update) | At 390px the three sat in equal columns and "Update progress" spilled out of its button on every order showing all three. Now two to a row, the third below (this run's PR) |
| 2026-11-01 | QC record (Record QC sheet) | keyboard only, desk light, quality | Opens with focus on Close, Tab walks style, type, Pass/Fail, fields; Escape closes and focus returns to Record QC: fine |
| 2026-11-01 | Factory panel, buyer page | empty state: a factory and a buyer with no orders, phone + desk, light + dark | Plain "No open orders" in English and Hindi; a factory or buyer login without its factory or buyer can't exist (database check). Fine |
| 2026-11-01 | Order page tabs, Details save, every sheet (Record QC, Update progress, factory Mark step done, search) | browser / phone Back (exploration: Back with a sheet open) | Order tabs and saves: Back walks the tabs, then leaves, fine. But Back with a sheet open left the page (a factory on its panel left the app) and threw away what was typed. Fixed (this run's PR): every sheet takes one history entry, Back closes it; Close, Escape and saving take the entry off; a search pick replaces it, so Back from the order returns to where search was opened |
| 2026-11-01 | Help sheet ("Open Brief" and every topic link), Start production sheet ("add the buyer's PO"), inquiry sheet links | phone Back after following a link inside a sheet (exploration) | The new page opened, but the first Back did nothing (it landed on the sheet's leftover history entry), so it took two Backs to return. Fixed (this run's PR): `sheet-back.tsx` takes the sheet's entry off first, then opens the link (a same-page part like #details-po opens as a plain hash change); one Back returns |
| 2026-11-01 | Record cheque, cheque page | slow network (2 s latency) + double and triple tap, accounts phone | One cheque saved, button says "Saving…" and is disabled, lands on the cheque with "saved": fine. But the cheque page and the ticked-cheques bar showed both "Mark deposited" and "Mark cleared" as primary (DESIGN.md: one primary). Now only the next bank step is primary; an owner's "Correct to" button never is (this run's PR) |

Not yet looked at from any angle beyond the crawl: date edges (month and year end; a year-old order done 1 Nov),
two people on the style sizes and QC record (only order Details so far), empty states for roles other than owner,
factory PO accept link with a real token (accept twice, accept after approval withdrawn; needs the po-inbox function, the local stand-in can't test it).
Print views not yet looked at: buyer PO PDF; a printed form's Styles table is cut at the right edge (nobody prints a blank form, low value). Angles never tried: slow network on a whole save flow (challan number 30 Oct, record cheque 1 Nov; not yet invoice, factory bill, QC record with photos), keyboard only on order page Details (QC record done 1 Nov, factory panel 31 Oct), a link inside a sheet opened in a new tab (long-press on a phone), year end with the server's clock (only checked by reading the date code: India-time today, other years shown with the year).

## Closed
| Item | How | Date |
|---|---|---|
| First Back after a link inside a sheet (Help, Start production, inquiry) did nothing; two primary buttons on the cheque page | Fixed (this run's PR) | 2026-11-01 |
| Phone Back with a sheet open left the page and lost the half-filled sheet | Fixed (this run's PR): `src/components/sheet-back.tsx` | 2026-11-01 |
| Dates written without their year on nine screens (Brief, next step, Today, styles, samples, bills); order page extra buttons overflowing on a phone | Fixed (this run's PR) | 2026-11-01 |
| New order: ship date before PO date showed a raw database error; negative rate said "must be a number" | Plain messages + ship date can't be picked before the PO date (this run's PR) | 2026-10-29 |
| Order hero stray dot, catalogue "No step done yet" chips and shuffled styles, long names flooding catalogue cards, Reports step bars reading as "0% late", factory PO print losing columns with long style names | Fixed (this run's PR) | 2026-10-30 |
| Fabric lots and challans counted metres as pieces; date-times wrote "Sept" and dropped last year's year | Fixed (this run's PR) | 2026-10-30 |
| Sign-in: /login showed the form to someone signed in; spent link said "expired" while signed in; deep links lost after sign-in; no way to fix a typo'd email; raw rate-limit text. Your approvals: Enter/Escape and focus by keyboard | Fixed (this run's PR) | 2026-10-30 |
| New order by keyboard: Save anyway, Add style and Remove style lost focus; no skip link past the menu. "Sept" in Help notes, Activity and /po; printed buttons blank | Fixed (this run's PR) | 2026-10-31 |
| Bare 404 for a deleted or missing record; photo pickers showed no keyboard focus; empty Style catalogue showed filters; Back reopened spent cheque, invoice and inquiry forms | Fixed (this run's PR) | 2026-10-31 |
| Dark-mode print came out faint; brief printed its buttons; Factories and Buyer POs empty states; brief help open; error-page code ran into its sentence; no "Saved" after editing an order | Fixed (this run's PR) | 2026-10-31 |
| Tally invoices not syncing (SO-0020) | He ran the index change in the SQL editor; both parts show invoice SPL/26-27/202 | 2026-10-30 |
| Flavia AV-135 (PO 101) had no order | It is SO-0021; Flavia mix-up settled | 2026-10-30 |
| Hourly runs could not merge their own PRs | Allow rule added; runs merge on green since #190 | 2026-10-29 |
| Factory PO routine blocked on database permission | Dheeraj granted it | 2026-10-29 |
