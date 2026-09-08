# Daily Commercial Performance

Spectrum Killian daily commercial one-pager. One long scrollable page with three sections (Account Executives, Account Managers, Programs); the sections are also the pill tabs in the sticky header, which scroll to the section and stay lit while it is in view. Same header, colors and type as the Account Health app.

Static site on Vercel, no build step, no framework. Same deployment pattern as `skdla-account-health`.

## Files
- `index.html`: the whole page. Vanilla JS. Renders each section's tiles and table from `data.js`; keeps the placeholders until a section has data.
- `data.js`: `window.DCP_DATA` written by `pipeline/build.py`. Served no-cache so a refresh shows new numbers.
- `pipeline/build.py`: pulls from Supabase (SK Public) through the REST API and writes `data.js`. The three section builders are stubs until the metrics are decided.
- `.github/workflows/daily-refresh.yml`: nightly at 11:30 UTC (4:30 AM Pacific) plus manual run; commits `data.js`, Vercel auto-deploys.
- `vercel.json`: static config.

## Deploy (one time)
1. Create an empty private GitHub repo (suggested name `daily-commercial-performance`), then from this folder:
   `git remote add origin https://github.com/grantmcmasters/daily-commercial-performance.git` and `git push -u origin main`.
2. In Vercel (Analytics Team) import the repo, framework preset Other, project name `daily-commercial-performance`. The site lands at `https://daily-commercial-performance.vercel.app`.
3. In the GitHub repo add secrets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (same values as the Account Health repo) so the nightly Action can run.

## Refresh locally
`python pipeline/build.py` writes `data.js` next to `index.html` (uses the Supabase Integration `.env` when the env vars are not set). Commit and push to publish.

## data.js shape
```
{ "meta": { "run_ts", "run_date", "latest_invoice_date", "source" },
  "sections": {
    "ae":       { "lede", "tiles": [{value,label,sub,tone}], "columns": [{label,align}], "rows": [[...]], "note" },
    "am":       { ...same... },
    "programs": { ...same... } } }
```
