# Check and fix

The scheduled task "Sourcingo check and fix" starts a fresh Claude session every 8 hours that follows this file.
Its job: find glitches and rough edges before the team does, and fix the safe ones on its own.

**Never the same finding twice.** Dheeraj (29 Oct 2026): "we cannot find the same issue every time we run an
audit, we need to hunt for different glitches and discuss to fix them." `e2e/FOUND.md` is the memory of every
run. Anything already in it is not news: don't report it, don't ask about it again, don't open a thread for it.

## 1. Before anything
- `git fetch origin main && git checkout -B claude/hourly-check origin/main`.
- Read `e2e/FOUND.md` in full. Everything under **Needs Dheeraj** and **Known** is off limits for the summary.
- If an open pull request titled "Hourly check: ..." already exists, add to that one instead of opening another.
- Never touch another thread's open pull request or branch.

## 2. Checks (all of them, every run)
1. **App on made-up data**: `e2e/run.sh` (about 10 minutes). It builds a fresh local database from every
   migration plus `e2e/seed.sql`, runs the unit tests, and opens every screen as all 7 roles on phone and
   computer, light and dark, then `e2e/help.mjs` checks that Help shows nothing unasked and fits each role.
   Every `PROBLEM` line is a finding, unless `e2e/FOUND.md` lists it as Known.
2. **Build health**: `npm run lint`, `npm run typecheck`, and the database rule tests
   (`PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres supabase/tests/run.sh`, after `e2e/run.sh --up`).
3. **Live system, read only**, with the Supabase connector (project `zwqoogevoxpafzbdnptz`):
   - `select public.system_health()`: Tally reader, Gmail pickup, failed PO reads, storage and database size.
   - `get_advisors` (security and performance) for anything new.
   - `query_logs` for the API and Postgres since the last run: errors (5xx, exceptions) point at broken screens.
   - Data that makes the app lie: open orders past ship date by 30+ days, steps marked done in the future,
     factory POs waiting for approval over 2 days, buyer POs waiting to be checked over 2 days.
     These tables and columns are right (guessing names puts errors in the Postgres log that look like app errors):
     ```sql
     select
       (select count(*) from orders where status = 'open' and coalesce(revised_ship_date, ship_date) < current_date - 30) late30,
       (select count(*) from line_stages where done_on > current_date) done_in_future,
       (select count(*) from factory_pos where lock_requested_at < now() - interval '2 days' and accepted_at is null and released_at is null) factory_po_waiting,
       (select json_object_agg(status, n) from (select status, count(*) n from incoming_pos where created_at < now() - interval '2 days' group by 1) x) buyer_pos_over_2_days;
     ```
     Postgres log errors whose query ends in `-- source: POST /mcp` come from these checks, not from the app.
4. **Live deploy**: the latest commits on main have a green production deploy (GitHub deployments, as in
   `scripts/deploy-status.mjs`), and CI on main is green.
5. **Hunt somewhere new** (the main job of the run). From the **Coverage** table in `e2e/FOUND.md`, pick
   two pairs of area and angle that have never been looked at, or were looked at longest ago. Never repeat a
   pair from the last three runs. Then use the app the way a real person would in that situation: set up the
   data on the local stack (insert rows into the e2e database, or click through `e2e/shot.mjs --click`), walk
   the whole flow, screenshot with `node e2e/shot.mjs <role> <path> /tmp/x --screens 3` (add `--desk`,
   `--dark`), and write a short Playwright script when the angle needs it (slow network, double tap, back
   button, two tabs). Ask: is the next step obvious? Does anything break, mislead, overflow, cost an extra tap,
   or break `docs/DESIGN.md`? Real business sense counts: would Vidhi, QC, accounts or a factory get stuck?
6. **One exploration**: one thing no earlier run tried at all (a new edge case, a role crossing into another
   role's screen, a print view, a public link with a wrong token, a very old order). Add it to the angles or
   areas list in `e2e/FOUND.md` so later runs rotate through it too.

## 3. Fixing
- Fix on your own, in one pull request: crashes, console errors, failed requests, layout breaks, wrong or
  misleading text, broken links, failing tests, and small clear improvements from the screen look.
- Every fix keeps lint, typecheck, unit tests, database tests and the crawl green. Screenshot what you changed.
- Every screen change follows `docs/DESIGN.md`: shared blocks from `src/components/order-ui.tsx`, next steps only from
  `journey()`, colours only from the tokens. Never undo the design to make a fix easier.
- Open the pull request (title "Hourly check: <what>"), wait for CI, merge it when green, then confirm the Vercel
  production deploy is green.
- Do NOT on your own: change the live database (no migrations, no writes), change anything in Tally, email or
  message anyone outside, delete data, or make a large change to how a screen works. Those need Dheeraj: write
  them up in the run's final summary as "Needs Dheeraj" so the push notification reaches him, but only if the
  item is not already in `e2e/FOUND.md`. A known item is never raised again.
- Never skip, weaken or delete a test to get green.

## 4. Update the ledger
Before finishing, edit `e2e/FOUND.md` in the same pull request (or a small "Hourly check: ledger" pull request
when nothing else changed, merged on green like any other):
- Add a Coverage line for each area and angle looked at, with the result.
- Add every new finding: fixed ones go to **Closed** with the PR, safe-but-not-a-glitch ones to **Known**, and
  ones that need Dheeraj to **Needs Dheeraj** with today's date.
- Bump "last seen" for known items that still happen. Move items that are gone or answered to **Closed**.

## 5. Finish
End with a short summary in plain words of what is NEW this run only: new glitches found, what was fixed (with
the PR link), and new items that need Dheeraj. Never list checks that passed, known items, or things already
reported. If there is nothing new, say "All clear" and nothing else.

When the run happens in a project thread: if nothing new needs Dheeraj, resolve your own thread at the end
(`set_thread_resolved` true) so it never sits in his "waiting on you" list. Leave it open only for a new
"Needs Dheeraj" item, and then ask once.
