# Markers (MarkerPilot)

Markers is MarkerPilot inside Sourcingo OS: upload photos of a garment, Claude reads them and proposes the pieces,
sizes and fabrics, you confirm, and it nests the most efficient marker and exports it (PDF, DXF, cut list).
The orders team (owner, manager, merchandiser, accounts) sees it in the menu under Tools.

| Part | Where |
|---|---|
| The tool, one page with every library inlined | `public/markerpilot/index.html`, shown on `/markers` |
| How the page talks to the OS | `markerpilot/shim.js` |
| Saved styles (shared by the team) | table `marker_styles`, through `/api/markers/styles` |
| Photo reading | `/api/markers/jobs` stores the photos in `marker_job_parts`; `supabase/functions/marker-reader` reads them with the company's AI key (the one pasted on Incoming POs) |
| Rules and tests | `supabase/migrations/0033_markers.sql`, `supabase/tests/markers.sql` |

Supabase stops a function after 150 seconds on the free plan. A reading that takes longer is handed to Claude's
batch queue and collected when it is ready (usually minutes, at most an hour); the page keeps waiting.

## Updating the tool

MarkerPilot's source (engine, screens, tests) lives in the project's MarkerPilot folder. After changing it, build its
website page (`node web/build.cjs ...` there), then rebuild this page from it:

```
node markerpilot/build-page.cjs <MarkerPilot>/web/public/index.html
```

## Putting it live

1. Apply `supabase/migrations/0033_markers.sql`.
2. Deploy the function: `supabase functions deploy marker-reader --no-verify-jwt` (it checks the person itself, like `po-inbox`).
3. Merge to main; Vercel deploys the app.
