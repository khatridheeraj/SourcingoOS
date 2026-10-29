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
| Tally invoices not syncing (SO-0020 invoice): fix waits on his go and a Supabase approval, in its own thread | 2026-10-27 | 2026-10-29 |
| Flavia AV-135 (PO 101) has no order: where should it go? In its own thread | 2026-10-26 | 2026-10-29 |
| Nightly database backup needs a GitHub secret from him | 2026-10-24 | 2026-10-29 |
| One buyer PO in "To check" and one held, both over 2 days old (live data, team's job). 29 Oct 17:00Z: only the held one is left | 2026-10-29 | 2026-10-29 |

## Known (not new, never report)
| Item | Why it is not a finding | Last seen |
|---|---|---|
| Crawl flags a page "slow" or ERR_CONNECTION_* on a cold or reloading dev server | Fast on reload; only a finding if it stays slow on recheck | 2026-10-29 |
| Postgres log errors whose query ends in `-- source: POST /mcp` | Come from the run's own checks, not the app | 2026-10-29 |
| Gmail pickup has found no new buyer PO for days | No buyer has emailed a PO; not a glitch | 2026-10-29 |
| Factory PO emails all go to merchandiser@sourcingo.in | Test inbox mode, on purpose until Dheeraj says switch | 2026-10-29 |
| Markers screen paused | MARKERS_ON flag, on purpose | 2026-10-29 |
| Supabase advisors: security-definer functions callable by anon/authenticated, RLS on with no policy, one mutable search_path, leaked-password check off | Long-standing by design (the app's RPCs are security definer and check the role inside); not new | 2026-10-29 |
| Local stack: Next dev logs "The destination stream closed early" after a save that redirects | Dev-server noise when a page is left mid-stream; not seen in production | 2026-10-29 |
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
browser back after saving, two people editing the same order, date edges (month end, year end, today vs
tomorrow), keyboard only, form errors (blank, wrong format, negative numbers), public links with a wrong or
made-up token (/po, /f, /s).

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

Not yet looked at from any angle beyond the crawl: large order, Hindi text, slow network, two people editing,
date edges, keyboard only, empty states, Reports, Styles, Updates, Activity, Team, Tally, Feedback, login,
factory PO accept link with a real token (accept twice, accept after approval withdrawn).

## Closed
| Item | How | Date |
|---|---|---|
| New order: ship date before PO date showed a raw database error; negative rate said "must be a number" | Plain messages + ship date can't be picked before the PO date (this run's PR) | 2026-10-29 |
| Hourly runs could not merge their own PRs | Allow rule added; runs merge on green since #190 | 2026-10-29 |
| Factory PO routine blocked on database permission | Dheeraj granted it | 2026-10-29 |
