"""Daily Commercial Performance: builds data.js from Supabase.

Skeleton version. Connects to the SK Public project through the REST API, records the
refresh time and the latest invoice date, and writes the three section blocks empty.
Fill in build_ae(), build_am() and build_programs() once the metrics are decided.

Run locally:   python pipeline/build.py            (writes ./data.js next to index.html)
In CI:         SUPABASE_URL / SUPABASE_SERVICE_KEY come from repo secrets (see .github/workflows).
Locally it falls back to the Supabase Integration .env, same as the Account Health pipeline.
"""
import datetime as dt
import json
import os
import sys

import requests

ENV_PATH = (r"C:\Users\GrantMcMasters\The Dental Alliance\SKDLA Team Files - Documents"
            r"\General\A - Analytics\Code\Supabase Integration\.env")


def load_env(path=ENV_PATH):
    env = {}
    if not os.path.exists(path):
        return env
    for line in open(path, encoding="utf8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
    URL = os.environ["SUPABASE_URL"].rstrip("/")
    KEY = os.environ["SUPABASE_SERVICE_KEY"]
else:
    _env = load_env()
    URL = _env.get("SUPABASE_URL", "").rstrip("/")
    KEY = _env.get("SUPABASE_SERVICE_KEY", "")
if not URL or not KEY:
    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set and no .env found")

HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Accept": "application/json"}


def get(table, params, page=1000, key=None, max_rows=None):
    """Fetch rows from PostgREST. Keyset-paginate on `key` when given (never offset)."""
    rows, last = [], None
    while True:
        p = dict(params)
        p["limit"] = page
        if key:
            p["order"] = f"{key}.asc"
            if last is not None:
                p[key] = f"gt.{last}"
        r = requests.get(f"{URL}/rest/v1/{table}", params=p, headers=HEADERS, timeout=120)
        if r.status_code >= 400:
            raise RuntimeError(f"{r.status_code} {r.text[:500]}")
        batch = r.json()
        rows += batch
        if key and batch:
            last = batch[-1][key.strip('"')]
        if len(batch) < page or not key or (max_rows and len(rows) >= max_rows):
            break
    return rows


def rpc(fn, args=None):
    """Call a Postgres function exposed through PostgREST."""
    r = requests.post(f"{URL}/rest/v1/rpc/{fn}", json=args or {}, headers=HEADERS, timeout=300)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text[:500]}")
    return r.json()


# ---------------------------------------------------------------------------
# Section builders. Each returns the shape index.html renders:
#   {"lede": str, "tiles": [{"value","label","sub","tone"}],
#    "columns": [{"label","align"}], "rows": [[...]], "note": str}
# Empty dict = keep the placeholders on the page.
# ---------------------------------------------------------------------------

def build_ae():
    """Account Executives. TODO: metrics to be defined."""
    return {}


def build_am():
    """Account Managers. TODO: metrics to be defined."""
    return {}


def build_programs():
    """Programs. TODO: metrics to be defined."""
    return {}


# ---------------------------------------------------------------------------

def latest_invoice_date():
    rows = get("Line Items", {"select": '"Invoice Date"', "order": '"Invoice Date".desc.nullslast', "limit": 1}, page=1)
    return rows[0]["Invoice Date"] if rows else None


def pacific_now():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:
        return dt.datetime.now(dt.timezone.utc)


def sanitize(text):
    """House style: no em or en dashes in anything the page shows."""
    return (text.replace("\u2014", ", ").replace("\u2013", "-")
                .replace("\\u2014", ", ").replace("\\u2013", "-"))


def main():
    out = os.environ.get("DCP_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data.js")
    now_utc = dt.datetime.now(dt.timezone.utc)
    data = {
        "meta": {
            "run_ts": now_utc.isoformat(timespec="seconds"),
            "run_date": pacific_now().strftime("%Y-%m-%d"),
            "latest_invoice_date": latest_invoice_date(),
            "source": "Supabase SK Public",
        },
        "sections": {
            "ae": build_ae(),
            "am": build_am(),
            "programs": build_programs(),
        },
    }
    body = "window.DCP_DATA = " + sanitize(json.dumps(data, ensure_ascii=True, separators=(",", ":"))) + ";\n"
    with open(os.path.abspath(out), "w", encoding="utf8", newline="\n") as f:
        f.write(body)
    print(f"wrote {os.path.abspath(out)} ({len(body):,} bytes); latest invoice date {data['meta']['latest_invoice_date']}")


if __name__ == "__main__":
    main()
