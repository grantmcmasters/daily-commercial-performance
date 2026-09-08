"""Daily Commercial Performance: builds data.js from Supabase.

Account Executive section engine (v2, 2026-09-08, practice level only)
----------------------------------------------------------------------
For each partner subsection (Aspen ClearChoice, Aspen Dental, Aspen Beacon, MB2) this
computes, at the PRACTICE level (Practice ID, rolled up through the Incisive links):

  * month by month YTD submitters split New / Active / Dabbler,
  * current cards: total network, active (super + core), dabblers, YTD penetration,
    MTD net new submitters,
  * month over month transitions (new, returned, promoted, held, demoted, went quiet).

Counting rules mirror the Account Health pipeline's case base (one business unit per case
from the primary product, manufacturing jigs dropped, TRI rebills dropped, corporate sample
accounts dropped, lab / university / intercompany accounts dropped) with these deliberate
differences, per Grant 2026-09-08:
  * Aspen Beacon non-LFX cases are KEPT (this page reports the whole Beacon book).
  * Any case with LFX Unit Flag = Yes billed to an Aspen Beacon account counts as an
    Aspen Dental case for that store. Beacon and Aspen Dental accounts share the store
    practice id (4-digit office code at the start of the practice name).
  * Aspen Beacon = Beacon cases with LFX Unit Flag <> Yes.
  * Network denominators: ClearChoice 106, MB2 845, Aspen Dental and Aspen Beacon share
    the higher of their two practice counts.

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
    {"key": "aspen-clearchoice", "title": "Aspen ClearChoice", "partner": "Aspen ClearChoice", "ae": "Jillian Doss",
     "logo": "logos/clearchoice.svg", "network": 106, "network_note": "106 ClearChoice centers in the network"},
    {"key": "aspen-dental", "title": "Aspen Dental", "partner": "Aspen Dental", "ae": "Jillian Doss",
     "logo": "logos/aspen-dental.svg", "network": "aspen", "network_note": "Aspen stores (higher of the Aspen Dental and Beacon counts)"},
    {"key": "aspen-beacon", "title": "Aspen Beacon", "partner": "Aspen Beacon", "ae": "Jillian Doss",
     "logo": "logos/aspen-beacon.png", "network": "aspen", "network_note": "Aspen stores (higher of the Aspen Dental and Beacon counts)"},
    {"key": "mb2", "title": "MB2 Dental", "partner": "MB2", "ae": "Erin Vaughan",
     "logo": "logos/mb2.png", "network": 845, "network_note": "845 practices in the MB2 network"},
]
SA_T = {"CB": 60, "IMP": 12, "REM": 30, "FA": 12, "HE": 12}          # full bar, both windows
CORE_T = {k: math.ceil(v / 2) for k, v in SA_T.items()}               # half bar, last 90 days
CORP_EXCLUDE = {"OC7540", "OCASP7484", "OCASP00", "OC1380", "OC6077", "OC9053", "OC7630"}
SEG_EXCLUDE = {"Lab", "University", "Intercompany"}
QUIET, DABBLER, CORE, SUPER = 0, 1, 2, 3

PLAYS_PLACEHOLDER = [
    "Play 1: rep or commercial leader fills this in",
    "Play 2: which practices, what action, by when",
    "Play 3: owner and next check-in",
]


def next_month(d):
    return (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def ytd_months(run_date):
    """[(label, month_first_day, snapshot_date)] for Jan of the run year through the run month.

    Cases received on the run date are not counted (data through yesterday), so a month has
    nothing to show until the 2nd: on the 1st the last column is the completed month.  On
    January 1 the list would be empty, so December of the prior year is shown instead.
    """
    out = []
    m = dt.date(run_date.year, 1, 1)
    while m < run_date:
        nm = next_month(m)
        s = nm if nm <= run_date else run_date
        label = m.strftime("%b") + (" MTD" if s == run_date and run_date != nm else "")
        out.append((label, m, s))
        m = nm
    if not out:
        dec = dt.date(run_date.year - 1, 12, 1)
        out.append((dec.strftime("%b %Y"), dec, run_date))
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
    """Sorted case dates for one practice, with per-line date lists."""
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
        if self._count(self.dates, s - dt.timedelta(days=90), s) == 0:
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
    print("loading Cases (all history, five columns) ...", flush=True)
    cases = get("Cases", {"select": '"Case Number","Account Number","Received Date","Primary Product Number","LFX Unit Flag"'}, key='"Case Number"')
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

    # in-scope accounts, with the pipeline's universe exclusions
    scope = {}   # account number -> (partner, practice id)
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
        pid = legacy.get(an) or (a.get("Practice ID") or "").strip()
        if not pid:                      # same rule as the pipeline: no practice id, not counted
            excluded[sp] += 1
            continue
        scope[an] = (sp, pid)

    # practice universe per subsection. Aspen Dental and Aspen Beacon share the store list.
    pids_by_partner = defaultdict(set)
    for an, (sp, pid) in scope.items():
        pids_by_partner[sp].add(pid)
    aspen_stores = pids_by_partner["Aspen Dental"] | pids_by_partner["Aspen Beacon"]
    aspen_network = max(len(pids_by_partner["Aspen Dental"]), len(pids_by_partner["Aspen Beacon"]))
    universe = {
        "Aspen ClearChoice": pids_by_partner["Aspen ClearChoice"],
        "Aspen Dental": aspen_stores,
        "Aspen Beacon": aspen_stores,
        "MB2": pids_by_partner["MB2"],
    }

    # counted cases -> practice entities per subsection, with the LFX routing rule
    ents = defaultdict(Entity)       # (subsection partner, pid) -> Entity
    seen = set()
    dropped = defaultdict(int)
    routed_lfx = 0
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
        if sp == "Aspen Beacon" and (c.get("LFX Unit Flag") or "").strip() == "Yes":
            sp = "Aspen Dental"          # LFX work billed to the Beacon account belongs to the Aspen Dental store
            routed_lfx += 1
        ents[(sp, pid)].add(d, line)
    for e in ents.values():
        e.finish()

    months = ytd_months(RUN_DATE)
    jan1 = dt.date(RUN_DATE.year, 1, 1)
    snaps = [jan1] + [s for _, _, s in months]      # Jan 1 = state at the end of December (baseline)
    cur_m0 = months[-1][1]

    subsections = []
    validation = {}
    for pdef in PARTNERS:
        sp = pdef["partner"]
        ids = sorted(universe[sp])
        E = {pid: ents[(sp, pid)] for pid in ids if (sp, pid) in ents}
        lv = {pid: [E[pid].level(s) if pid in E else QUIET for s in snaps] for pid in ids}
        cur = [lv[pid][-1] for pid in ids]
        n_super = sum(1 for x in cur if x == SUPER)
        n_core = sum(1 for x in cur if x == CORE)
        n_dab = sum(1 for x in cur if x == DABBLER)
        ytd_sub = sum(1 for pid in ids if pid in E and E[pid].cases_between(jan1, RUN_DATE) > 0)
        mtd_new = sum(1 for pid in ids if pid in E and E[pid].first is not None and cur_m0 <= E[pid].first < RUN_DATE)
        network = aspen_network if pdef["network"] == "aspen" else pdef["network"]
        cards = {
            "total": network, "total_note": pdef["network_note"] + f"; {len(ids):,} in our system",
            "in_system": len(ids),
            "active": n_super + n_core, "super": n_super, "core": n_core,
            "dabblers": n_dab, "ytd_submitters": ytd_sub,
            "penetration_pct": int(round(100.0 * ytd_sub / network)) if network else None,
            "mtd_net_new": mtd_new,
        }
        mrows = []
        for i, (label, m0, s) in enumerate(months):
            idx = i + 1
            new = act = dab = 0
            for pid in ids:
                e = E.get(pid)
                if not e or e.cases_between(m0, s) == 0:
                    continue
                if e.first is not None and m0 <= e.first < s:
                    new += 1
                elif lv[pid][idx] >= CORE:
                    act += 1
                else:
                    dab += 1
            mrows.append({"m": m0.strftime("%Y-%m"), "label": label, "new": new, "active": act, "dabbler": dab, "total": new + act + dab})
        keys = ["new", "returned", "promo_core", "promo_super", "held", "demote_core", "demote_dab", "quiet"]
        tr = {k: [] for k in keys}
        net = []
        for i, (label, m0, s) in enumerate(months):
            idx = i + 1
            c = dict.fromkeys(keys, 0)
            for pid in ids:
                e = E.get(pid)
                prev, curl = lv[pid][idx - 1], lv[pid][idx]
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
        subsections.append({
            "key": pdef["key"], "title": pdef["title"], "partner": sp, "ae": pdef["ae"], "logo": pdef["logo"],
            "network": network, "plays": list(PLAYS_PLACEHOLDER),
            "cards": cards, "months": mrows,
            "transitions": {"months": [r["label"] for r in mrows],
                            "rows": [{"key": k, "label": lab, "hint": hint, "tone": tone, "values": tr[k]} for k, lab, hint, tone in row_defs],
                            "net": net},
        })
        validation[sp] = {"super": n_super, "core": n_core, "dabbler": n_dab, "quiet": len(ids) - n_super - n_core - n_dab,
                          "in_system": len(ids), "network": network, "excluded_accounts": excluded.get(sp, 0)}

    print("dropped cases:", dict(dropped), "| Beacon LFX cases routed to Aspen Dental:", routed_lfx, flush=True)
    print("practice state at run date (compare with cs_activity_state):", json.dumps(validation), flush=True)
    return {
        "as_of": RUN_DATE.isoformat(),
        "year": RUN_DATE.year,
        "definition": {
            "super_active": "full bar in one business unit in each of the last two 90 day windows (CB 60, REM 30, IMP 12, FA 12, HE 12)",
            "core_active": "half bar in one business unit in the last 90 days (CB 30, REM 15, IMP 6, FA 6, HE 6)",
            "dabbler": "at least one case in the last 90 days, below every bar",
            "new": "first ever case received in that month",
            "lfx": "LFX cases billed to an Aspen Beacon account count as Aspen Dental for that store; Aspen Beacon shows Beacon non-LFX cases",
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
            "data_through": (RUN_DATE - dt.timedelta(days=1)).isoformat(),
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
