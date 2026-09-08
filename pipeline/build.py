"""Daily Commercial Performance: builds data.js from Supabase.

Account Executive section engine (v1, 2026-09-08)
-------------------------------------------------
For each partner subsection (Aspen ClearChoice, Aspen Dental, Aspen Beacon, MB2) and for
each grain (accounts = Account Number, practices = Practice ID rolled up through the
Incisive links) this computes, from the raw Cases table:

  * month by month YTD submitters split New / Active / Dabbler,
  * current cards: total, active (super + core), dabblers, YTD penetration,
  * month over month transitions (new, returned, promoted, held, demoted, went quiet).

It applies the SAME counting rules as the Account Health pipeline's case base
(one business unit per case from the primary product, manufacturing jigs dropped, TRI
rebills dropped, corporate sample accounts dropped, lab / university / intercompany
accounts dropped) with ONE deliberate difference: Aspen Beacon non-LFX cases are kept,
because this page reports the whole Beacon book, not the modeled book.

Activity definition (matches active-customer-logic.md and the nightly scorer):
  snapshot s evaluates cases received in [s-90, s) (q1) and [s-180, s-90) (q2), one
  business unit per case.  SUPER_ACTIVE = any unit at the full bar in both windows.
  CORE ACTIVE = any unit at half the bar in q1.  DABBLER = any counted case in q1 but no
  bar cleared.  QUIET = no counted case in q1.  NEW = first ever counted case falls in the
  month (New wins over the other three in the monthly chart).
  Month M is evaluated at s = first day of M+1; the current month at s = run date.

Run locally:   python pipeline/build.py            (writes ./data.js next to index.html)
In CI:         SUPABASE_URL / SUPABASE_SERVICE_KEY come from repo secrets.
"""
import bisect
import datetime as dt
import json
import math
import os
import sys
from collections import defaultdict

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
PAGE = 10000


def get(table, params, page=PAGE, key=None, max_rows=None):
    """Fetch rows from PostgREST. Keyset-paginate on `key` when given (never offset)."""
    rows, last = [], None
    while True:
        p = dict(params)
        p["limit"] = page
        if key:
            p["order"] = f"{key}.asc"
            if last is not None:
                p[key] = f"gt.{last}"
        r = requests.get(f"{URL}/rest/v1/{table}", params=p, headers=HEADERS, timeout=180)
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
    r = requests.post(f"{URL}/rest/v1/rpc/{fn}", json=args or {}, headers=HEADERS, timeout=300)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text[:500]}")
    return r.json()


def pacific_today():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("America/Los_Angeles")).date()
    except Exception:
        return dt.datetime.now(dt.timezone.utc).date()


RUN_DATE = dt.date.fromisoformat(os.environ["DCP_RUN_DATE"]) if os.environ.get("DCP_RUN_DATE") else pacific_today()

# ---------------------------------------------------------------------------
# Account Executive section: definitions
# ---------------------------------------------------------------------------
PARTNERS = [
    {"key": "aspen-clearchoice", "title": "Aspen ClearChoice", "partner": "Aspen ClearChoice", "ae": "Jillian Doss"},
    {"key": "aspen-dental", "title": "Aspen Dental", "partner": "Aspen Dental", "ae": "Jillian Doss"},
    {"key": "aspen-beacon", "title": "Aspen Beacon", "partner": "Aspen Beacon", "ae": "Jillian Doss"},
    {"key": "mb2", "title": "MB2", "partner": "MB2", "ae": "Erin Vaughan",
     "network_practices": 845, "network_note": "845 practices in the MB2 network; 249 have an account with us"},
]
SA_T = {"CB": 60, "IMP": 12, "REM": 30, "FA": 12, "HE": 12}          # full bar, both windows
CORE_T = {k: math.ceil(v / 2) for k, v in SA_T.items()}               # half bar, last 90 days
LINES = list(SA_T.keys())
CORP_EXCLUDE = {"OC7540", "OCASP7484", "OCASP00", "OC1380", "OC6077", "OC9053", "OC7630"}
SEG_EXCLUDE = {"Lab", "University", "Intercompany"}
QUIET, DABBLER, CORE, SUPER = 0, 1, 2, 3
LEVEL_NAME = {QUIET: "Quiet", DABBLER: "Dabbler", CORE: "Core Active", SUPER: "Super Active"}

PLAYS_PLACEHOLDER = [
    "Play 1: rep or commercial leader fills this in",
    "Play 2: which accounts, what action, by when",
    "Play 3: owner and next check-in",
]


def month_start(d):
    return d.replace(day=1)


def next_month(d):
    return (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def ytd_months(run_date):
    """[(label, month_first_day, snapshot_date)] for Jan of the run year through the run month."""
    out = []
    m = dt.date(run_date.year, 1, 1)
    while m <= run_date:
        nm = next_month(m)
        s = nm if nm <= run_date else run_date
        label = m.strftime("%b") + (" (MTD)" if s == run_date and run_date != nm else "")
        out.append((label, m, s))
        m = nm
    return out


def line_of(l1, l2):
    if l2 == "Implant":
        return "IMP"
    if l1 == "Full Arch":
        return "FA"
    if l1 == "Removable":
        return "REM"
    if l1 == "High Esthetics":
        return "HE"
    if l1 == "Restorative":
        return "CB"
    return "OTH"


class Entity:
    """Sorted case dates for one account or practice, with per-line date lists."""
    __slots__ = ("dates", "by_line", "first")

    def __init__(self):
        self.dates = []
        self.by_line = defaultdict(list)
        self.first = None

    def add(self, d, line):
        self.dates.append(d)
        if line in SA_T:
            self.by_line[line].append(d)

    def finish(self):
        self.dates.sort()
        for v in self.by_line.values():
            v.sort()
        self.first = self.dates[0] if self.dates else None

    @staticmethod
    def _count(lst, lo, hi):
        """count of dates d with lo <= d < hi"""
        return bisect.bisect_left(lst, hi) - bisect.bisect_left(lst, lo)

    def level(self, s):
        q1_any = self._count(self.dates, s - dt.timedelta(days=90), s)
        if q1_any == 0:
            return QUIET
        sa = core = False
        for ln, lst in self.by_line.items():
            q1 = self._count(lst, s - dt.timedelta(days=90), s)
            q2 = self._count(lst, s - dt.timedelta(days=180), s - dt.timedelta(days=90))
            if q1 >= SA_T[ln] and q2 >= SA_T[ln]:
                sa = True
            if q1 >= CORE_T[ln]:
                core = True
        return SUPER if sa else (CORE if core else DABBLER)

    def cases_between(self, lo, hi):
        return self._count(self.dates, lo, hi)


def load_ae_inputs():
    print("loading Accounts ...", flush=True)
    accounts = get("Accounts", {"select": '"Account Number","Strategic Partner","Practice ID","Practice Name","Market Segment","Intercompany"'},
                   key='"Account Number"')
    print("loading Products ...", flush=True)
    products = get("Products", {"select": '"Product Number","Product Name","Business Unit L1","Business Unit L2"'}, key='"Product Number"')
    print("loading Incisive links and TRI rebills ...", flush=True)
    links = get("cs_incisive_links", {"select": "new_account,legacy_practice_id"})
    rebills = {r["case_number"] for r in get("tri_rebill_cases", {"select": "case_number"})}
    print("loading Cases (all history, four columns) ...", flush=True)
    cases = get("Cases", {"select": '"Case Number","Account Number","Received Date","Primary Product Number"'}, key='"Case Number"')
    print(f"  {len(accounts):,} accounts, {len(products):,} products, {len(cases):,} cases", flush=True)
    return accounts, products, links, rebills, cases


def build_ae(inputs=None):
    accounts, products, links, rebills, cases = inputs or load_ae_inputs()
    partner_of = {p["partner"] for p in PARTNERS}
    legacy = {l["new_account"]: l["legacy_practice_id"] for l in links if l.get("new_account")}
    prod = {}
    for p in products:
        pn = p.get("Product Number")
        if pn and pn not in prod:
            prod[pn] = (line_of(p.get("Business Unit L1"), p.get("Business Unit L2")),
                        "manufacturing jig" in (p.get("Product Name") or "").lower())

    # in-scope accounts per partner, with the pipeline's universe exclusions
    scope = {}   # account number -> (partner, pid)
    excluded = defaultdict(int)
    for a in accounts:
        sp = (a.get("Strategic Partner") or "").strip()
        if sp not in partner_of:
            continue
        an = (a.get("Account Number") or "").strip()
        if not an:
            continue
        if an in CORP_EXCLUDE or (a.get("Market Segment") or "").strip() in SEG_EXCLUDE \
                or (a.get("Intercompany") or "").strip() == "Yes" or "(dds" in (a.get("Practice Name") or "").lower():
            excluded[sp] += 1
            continue
        pid = legacy.get(an) or (a.get("Practice ID") or "").strip() or ("acct:" + an)
        scope[an] = (sp, pid)

    # counted cases -> entities at both grains. Practices are rolled up WITHIN a partner
    # (key = partner + practice id): Aspen Dental doctors and the store's Aspen Beacon account
    # share a store-level practice id, and each partner's view must only count its own cases.
    ents = {"accounts": defaultdict(Entity), "practices": defaultdict(Entity)}
    seen = set()
    dropped = defaultdict(int)
    for c in cases:
        an = (c.get("Account Number") or "").strip()
        if an not in scope:
            continue
        cn = c.get("Case Number")
        if not cn or cn in seen:
            continue
        seen.add(cn)
        if cn in rebills:
            dropped["tri_rebill"] += 1
            continue
        rd = c.get("Received Date")
        if not rd:
            dropped["no_received"] += 1
            continue
        d = dt.date.fromisoformat(rd[:10])
        if d >= RUN_DATE:
            dropped["future"] += 1
            continue
        line, jig = prod.get(c.get("Primary Product Number"), ("OTH", False))
        if jig:
            dropped["jig"] += 1
            continue
        sp, pid = scope[an]
        ents["accounts"][an].add(d, line)
        ents["practices"][(sp, pid)].add(d, line)
    for g in ents.values():
        for e in g.values():
            e.finish()

    # every in-scope entity, even the ones that never sent a case (they are in the totals)
    universe = {"accounts": defaultdict(set), "practices": defaultdict(set)}
    for an, (sp, pid) in scope.items():
        universe["accounts"][sp].add(an)
        universe["practices"][sp].add(pid)

    months = ytd_months(RUN_DATE)
    jan1 = dt.date(RUN_DATE.year, 1, 1)
    baseline_s = jan1                      # state at the end of December = snapshot on Jan 1
    snaps = [baseline_s] + [s for _, _, s in months]

    subsections = []
    validation = {}
    for pdef in PARTNERS:
        sp = pdef["partner"]
        sub = {"key": pdef["key"], "title": pdef["title"], "partner": sp, "ae": pdef["ae"],
               "plays": list(PLAYS_PLACEHOLDER), "by_grain": {}}
        for grain in ("accounts", "practices"):
            ids = sorted(universe[grain][sp])
            raw = ents[grain]
            E = {eid: raw.get(eid if grain == "accounts" else (sp, eid)) for eid in ids}
            E = {k: v for k, v in E.items() if v is not None}
            # levels per snapshot
            lv = {}
            for eid in ids:
                e = E.get(eid)
                lv[eid] = [e.level(s) if e else QUIET for s in snaps]
            # current cards
            cur = [lv[eid][-1] for eid in ids]
            n_super = sum(1 for x in cur if x == SUPER)
            n_core = sum(1 for x in cur if x == CORE)
            n_dab = sum(1 for x in cur if x == DABBLER)
            ytd_sub = sum(1 for eid in ids if E.get(eid) and E[eid].cases_between(jan1, RUN_DATE) > 0)
            total = len(ids)
            denom = pdef.get("network_practices") if grain == "practices" and pdef.get("network_practices") else total
            cards = {
                "total": total, "total_note": (pdef.get("network_note") if grain == "practices" and pdef.get("network_practices") else "in our system"),
                "denominator": denom,
                "active": n_super + n_core, "super": n_super, "core": n_core,
                "dabblers": n_dab, "ytd_submitters": ytd_sub,
                "penetration_pct": round(100.0 * ytd_sub / denom, 1) if denom else None,
            }
            # monthly submitters: new / active / dabbler
            mrows = []
            for i, (label, m0, s) in enumerate(months):
                idx = i + 1
                new = act = dab = 0
                for eid in ids:
                    e = E.get(eid)
                    if not e or e.cases_between(m0, s) == 0:
                        continue
                    if e.first is not None and m0 <= e.first < s:
                        new += 1
                    elif lv[eid][idx] >= CORE:
                        act += 1
                    else:
                        dab += 1
                mrows.append({"m": m0.strftime("%Y-%m"), "label": label, "new": new, "active": act, "dabbler": dab, "total": new + act + dab})
            # transitions month over month
            keys = ["new", "returned", "promo_core", "promo_super", "held", "demote_core", "demote_dab", "quiet"]
            tr = {k: [] for k in keys}
            net = []
            for i, (label, m0, s) in enumerate(months):
                idx = i + 1
                c = dict.fromkeys(keys, 0)
                for eid in ids:
                    e = E.get(eid)
                    prev, curl = lv[eid][idx - 1], lv[eid][idx]
                    if e and e.first is not None and m0 <= e.first < s:
                        c["new"] += 1
                        continue
                    if prev == QUIET and curl >= DABBLER:
                        c["returned"] += 1
                    elif prev == DABBLER and curl == CORE:
                        c["promo_core"] += 1
                    elif prev in (DABBLER, CORE) and curl == SUPER:
                        c["promo_super"] += 1
                    elif prev == curl and curl >= DABBLER:
                        c["held"] += 1
                    elif prev == SUPER and curl == CORE:
                        c["demote_core"] += 1
                    elif prev in (SUPER, CORE) and curl == DABBLER:
                        c["demote_dab"] += 1
                    elif prev >= DABBLER and curl == QUIET:
                        c["quiet"] += 1
                for k in keys:
                    tr[k].append(c[k])
                net.append(c["returned"] + c["promo_core"] + c["promo_super"] - c["demote_core"] - c["demote_dab"] - c["quiet"])
            row_defs = [
                ("new", "New submitters", "First ever case this month", "new"),
                ("returned", "Returned", "Quiet for 90+ days, sent again", "up"),
                ("promo_core", "Promoted to Core Active", "Dabbler to Core Active", "up"),
                ("promo_super", "Promoted to Super Active", "Core (or Dabbler) to Super Active", "up"),
                ("held", "Held", "Same level as last month", "flat"),
                ("demote_core", "Demoted to Core Active", "Super Active to Core Active", "down"),
                ("demote_dab", "Demoted to Dabbler", "Core or Super Active to Dabbler", "down"),
                ("quiet", "Went quiet", "No case in 90 days", "quiet"),
            ]
            transitions = {
                "months": [r["label"] for r in mrows],
                "rows": [{"key": k, "label": lab, "hint": hint, "tone": tone, "values": tr[k]} for k, lab, hint, tone in row_defs],
                "net": net,
            }
            sub["by_grain"][grain] = {"cards": cards, "months": mrows, "transitions": transitions}
            if grain == "practices":
                validation[sp] = {"super": n_super, "core": n_core, "dabbler": n_dab, "quiet": total - n_super - n_core - n_dab,
                                  "total": total, "excluded_accounts": excluded.get(sp, 0)}
        subsections.append(sub)

    print("dropped cases:", dict(dropped), flush=True)
    print("practice-grain state at run date (compare with cs_activity_state):", json.dumps(validation), flush=True)
    return {
        "as_of": RUN_DATE.isoformat(),
        "year": RUN_DATE.year,
        "definition": {
            "super_active": "full bar in one business unit in each of the last two 90 day windows (CB 60, REM 30, IMP 12, FA 12, HE 12)",
            "core_active": "half bar in one business unit in the last 90 days (CB 30, REM 15, IMP 6, FA 6, HE 6)",
            "dabbler": "at least one case in the last 90 days, below every bar",
            "new": "first ever case received in that month",
        },
        "subsections": subsections,
    }


def build_am():
    """Account Managers. TODO: metrics to be defined."""
    return {}


def build_programs():
    """Programs. TODO: metrics to be defined."""
    return {}


def latest_invoice_date():
    rows = get("Line Items", {"select": '"Invoice Date"', "order": '"Invoice Date".desc.nullslast', "limit": 1}, page=1)
    return rows[0]["Invoice Date"] if rows else None


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
            "run_date": RUN_DATE.isoformat(),
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
    print(f"wrote {os.path.abspath(out)} ({len(body):,} bytes); run date {RUN_DATE}; latest invoice date {data['meta']['latest_invoice_date']}")


if __name__ == "__main__":
    main()
