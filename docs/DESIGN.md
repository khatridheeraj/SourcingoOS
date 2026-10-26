# Sourcingo design rules

These rules keep every screen consistent. Every change follows them, including the hourly check-and-fix runs.

## One idea per screen
- **Home** answers "what needs me today". The day header with its ring comes first, then one To do queue, ordered red first.
  The queue holds one block per order: the order's name once, then each job as one line with its own small button.
  Nothing else goes on Home but money for the owner and Accounts and the Tidy up list; overviews live on Orders and Reports.
- Red means the ship date will be missed. A step past its target while the ship date still holds is amber ("needs an update").
- **Orders** answers "where is everything". On a computer it is a board with one column per stage; on a phone it is a list of cards.
- **An order** answers "where is this order, and what do I do next". The hero, then the journey card with one next step, then one work area at a time.

## One source of truth for an order's state
- The stage (Factory, Plan, PO, Make, Final QC, Ship) and the single next step come from `journey()` in `src/lib/journey.ts`.
  Never work out "what's next" again on a screen: add the rule to `journey()` and to `journey.test.ts`.
- Days to ship come from `shipClock()`, and the order-page area a stage opens comes from `areaOf()`, both in the same file.

## Shared building blocks (`src/components/order-ui.tsx`)
- `ShipClock`: days to ship as one big number (`lg` on the order page, `sm` on cards).
- `StageMeter`: six short bars, one per stage, coloured by the next step's tone.
- `PhotoStack`: style photos, shown only when at least one exists.
- `Ring`: progress that fills as work gets done.
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
