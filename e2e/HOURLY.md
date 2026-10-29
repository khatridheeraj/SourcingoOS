# Hourly check and fix

The scheduled task "Sourcingo hourly check" starts a fresh Claude session every hour that follows this file.
Its job: find glitches and rough edges before the team does, and fix the safe ones on its own.

## 1. Before anything
- `git fetch origin main && git checkout -B claude/hourly-check origin/main`.
- If an open pull request titled "Hourly check: ..." already exists, add to that one instead of opening another.
- Never touch another thread's open pull request or branch.

## 2. Checks (all of them, every hour)
1. **App on made-up data**: `e2e/run.sh` (about 10 minutes). It builds a fresh local database from every
   migration plus `e2e/seed.sql`, runs the unit tests, and opens every screen as all 7 roles on phone and
   computer, light and dark, then `e2e/help.mjs` checks that Help shows nothing unasked and fits each role.
   Every `PROBLEM` line is a finding.
2. **Build health**: `npm run lint`, `npm run typecheck`, and the database rule tests
   (`PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres supabase/tests/run.sh`, after `e2e/run.sh --up`).
3. **Live system, read only**, with the Supabase connector (project `zwqoogevoxpafzbdnptz`):
   - `select public.system_health()`: Tally reader, Gmail pickup, failed PO reads, storage and database size.
   - `get_advisors` (security and performance) for anything new.
   - `query_logs` for the API and Postgres in the last hour: errors (5xx, exceptions) point at broken screens.
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
5. **One improvement look**: pick ONE screen in rotation (Home, Orders, an order page, Buyer POs, Inquiries,
   Samples, Goods with us, Payments, Bills to pay, factory panel, buyer page) and screenshot it with
   `node e2e/shot.mjs <role> <path> /tmp/x --screens 3` (and `--desk`). Ask: is the next step obvious? Is
   anything confusing, cramped, misaligned, wordy, or wrong in dark mode? Does it follow `docs/DESIGN.md`?
   Write down what you'd change.

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
  them up in the run's final summary as "Needs Dheeraj" so the push notification reaches him.
- Never skip, weaken or delete a test to get green.

## 4. Finish
End with a short summary in plain words: what was checked, what was fixed (with the PR link), and anything
that needs Dheeraj. If nothing was wrong and nothing was changed, say "All clear" and nothing else.
