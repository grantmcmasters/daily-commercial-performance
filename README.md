# Daily Commercial Performance

Spectrum Killian daily commercial one-pager. One long scrollable page with three sections (Account Executives, Account Managers, Programs); the sections are also the pill tabs in the sticky header, which scroll to the section and stay lit while it is in view. Each section lists its one pagers as links, and each one pager has a Back to section link. The pills are color coded: blue for the one pager sections, gold for Behind the Numbers and Account Drilldown (the same interface), grey for About, which is its own page. Same header, colors and type as the Account Health app.

Static site on Vercel, no build step, no framework. Same deployment pattern as `skdla-account-health`.

## Files
- `details.html` + `details-page.js`: the Behind the Numbers tab (every practice behind any number on the one pager, the qualification graphic, tiles, state by month, cases by month, Excel export) reading `details.js`, which the engine writes next to `data.js`. A navigator at the top lists every partner, account manager and program list. Metric codes `mon:<i>`, `wkp:<i>`, `wkyp:<i>` (from the month and week headings of the state tables) show the past, present, future view.
- `directory.js`: `window.DCP_DIRECTORY`, one row per practice in our system (partners, account executive, account manager, state today, cases YTD, last case, the page that opens it) for the Account Directory.
- `account.html` + `account-page.js`: the Account Directory (every practice, filterable by partner, account executive, account manager and state) and, with `?sec=&key=&pid=`, one practice's page, fed by `health/<section>-<key>.js` (a slice of the Account Health export written by the engine) and, for the Volume over time chart, live day-by-day rows from the same two public Supabase functions the Account Health page calls (`cs_v9_drill`, `cs_v9_case_drill`, public anon key). Default 90 day buckets, anchored so the last bucket ends today, with Core and Super guide lines and a stance strip per business unit; falls back to the month by month bars when the fetch fails.
- `about.html`: the definitions page (rendered by `app.js` from `data.js`); every page links to it in the footer and the About pill.
- `index.html`: markup and CSS. `app.js`: the page script (renders every section from `data.js`, the state table picker, and the Export slides button, which draws a PDF deck with jsPDF and svg2pdf using the brand fonts in `fonts/`).
- `data.js`: `window.DCP_DATA` written by `pipeline/build.py`. Served no-cache so a refresh shows new numbers.
- `pipeline/build.py`: pulls from Supabase (SK Public) through the REST API and writes `data.js`. The three section builders are stubs until the metrics are decided.
- Nightly refresh and morning email: moving to the lab script computer (Windows Task Scheduler); the GitHub workflow was removed on 2026-09-10 after its scheduler skipped runs.
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

## Morning email (4 AM Pacific)

`.github/workflows/daily-refresh.yml` runs every morning: it rebuilds `data.js`, renders the deck headlessly (`pipeline/export_deck.js`, the same jsPDF code as the Export slides button, with svg logos rasterized by resvg), writes an AI summary from a numbers-only digest (`pipeline/summarize.py`, Claude via the Messages API, falls back to a plain list of headline numbers if the API fails) and emails the note with the deck attached (named Daily Commercial Performance M.D.YY.pdf after the data-through date) (`pipeline/send_mail.py`, Gmail app password by default, any SMTP server via `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT`).

Repository secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `MAIL_FROM`, `MAIL_TO` (comma separated), and either `MS_TENANT_ID` + `MS_CLIENT_ID` + `MS_CLIENT_SECRET` (send as a Microsoft 365 mailbox through Graph, app registration with the Mail.Send application permission) or `MAIL_PASSWORD` (SMTP). Optional repository variables: `ANTHROPIC_MODEL`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`. Run it by hand from the Actions tab (`send_to` sends to a test address only; `skip_email` rebuilds the data without mailing). Local dry runs: `node pipeline/export_deck.js deck.pdf`, `python pipeline/summarize.py --dry-run`, `python pipeline/send_mail.py --dry-run`.
