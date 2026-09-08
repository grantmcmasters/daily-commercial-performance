"""Daily Commercial Performance: builds data.js from Supabase.

Account Executive section (practice level)
------------------------------------------
For each partner subsection (Aspen ClearChoice, Aspen Dental, Aspen Beacon, MB2), at the
PRACTICE level (Practice ID, rolled up through the Incisive links):
  * month by month YTD submitters split New / Active / Dabbler,
  * cards: total network, active (super + core), dabblers, YTD penetration, MTD net new,
  * month over month transitions (new, returned, promoted, held, demoted, went quiet).

Account Manager section (practice level)
----------------------------------------
One subsection per account manager (book = Accounts."Account Manager Combined"):
  * cards: submitters YTD, cases MTD with the pace against the same number of business days
    into last month, promoted to active and demoted from active in the last 30 days,
  * case volume by business day over the trailing 60 days (weekend and holiday volume is
    attributed to the business day before),
  * average revenue per submitting office per month, YTD, by partner group where the book
    spans several partners,
  * week over week this quarter: practices that moved up to active, down from active, net.

Counting rules mirror the Account Health pipeline's case base (one business unit per case
from the primary product, manufacturing jigs dropped, TRI rebills dropped, corporate sample
accounts dropped, lab / university / intercompany accounts dropped) with these deliberate
differences, per Grant 2026-09-08:
  * Aspen Beacon non-LFX cases are KEPT (the AE page reports the whole Beacon book).
  * Any case with LFX Unit Flag = Yes billed to an Aspen Beacon account counts as an
    Aspen Dental case for that store (Beacon and Aspen Dental accounts share the store
    practice id: the 4-digit office code at the start of the practice name). For the
    account managers the same LFX cases go to whoever manages the store's Aspen Dental account.
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
  Revenue = sum of Line Items "Price Net" per case, attributed to the case's received date.

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
JAN1 = dt.date(RUN_DATE.year, 1, 1)
DAY = dt.timedelta(days=1)

# ---------------------------------------------------------------------------
# Definitions
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
AMS = [
    {"key": "avery", "name": "Avery Neamand", "amc": ["Avery Neamand"], "label": "Aspen ClearChoice", "logos": ["logos/clearchoice.svg"], "lines": "all"},
    {"key": "susanne", "name": "Susanne Neumann", "amc": ["Susanne Neumann"], "label": "Aspen ClearChoice", "logos": ["logos/clearchoice.svg"], "lines": "all"},
    {"key": "collin", "name": "Collin Maccabe", "amc": ["Collin Maccabe"], "label": "Aspen Dental", "logos": ["logos/aspen-dental.svg"], "lines": "all"},
    {"key": "syed", "name": "Syed Zubair", "amc": ["Syed Zubair, Nikolas Olejnik"], "label": "Incisive", "logos": ["logos/incisive.png"], "lines": "all"},
    {"key": "liezl", "name": "Liezl Evangelista", "amc": ["Liezl Evangelista"], "label": "OC Private Practice", "logos": ["logos/spectrum-killian.png"], "lines": "all"},
    {"key": "nikolas", "name": "Nikolas Olejnik", "amc": ["Nikolas Olejnik"], "label": "MB2, Engel, S.I.N. 360 (non-Incisive book)",
     "logos": ["logos/mb2.png", "logos/engel.png", "logos/sin360.png"], "lines": ["MB2", "Engel", "S.I.N. 360"]},
    {"key": "ed", "name": "Ed Loonam", "amc": ["Ed Loonam"], "label": "Strategic partner book",
     "logos": ["logos/advantage-dental.png", "logos/affordable-dentures.png", "logos/pds.svg"], "lines": "top3"},
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


def prev_month(d):
    return (d.replace(day=1) - DAY).replace(day=1)


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


def quarter_bounds(run_date):
    """Weekly snapshot dates for the current quarter: quarter start, every 7 days, then the run date."""
    q0 = dt.date(run_date.year, 3 * ((run_date.month - 1) // 3) + 1, 1)
    bounds, b = [], q0
    while b < run_date:
        bounds.append(b)
        b += dt.timedelta(days=7)
    if bounds[-1] != run_date:
        bounds.append(run_date)
    return bounds


def quarter_label(run_date):
    return f"Q{(run_date.month - 1) // 3 + 1} {run_date.year}"


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


class BizCal:
    """Company business-day calendar from the Dates table (weekends and holidays out)."""

    def __init__(self, rows):
        self.biz = sorted(dt.date.fromisoformat(r["Date"][:10]) for r in rows if r.get("Is Business Day") == 1)
        self.bizset = set(self.biz)
        self.lo = self.biz[0] if self.biz else None
        self.hi = self.biz[-1] if self.biz else None

    def is_biz(self, d):
        if self.lo and self.lo <= d <= self.hi:
            return d in self.bizset
        return d.weekday() < 5

    def fold(self, d):
        """attribute a non-business day to the business day before it"""
        while not self.is_biz(d):
            d -= DAY
        return d

    def between(self, lo, hi):
        """business days lo <= d < hi"""
        out, d = [], lo
        while d < hi:
            if self.is_biz(d):
                out.append(d)
            d += DAY
        return out


# ---------------------------------------------------------------------------
# Inputs (loaded once, shared by both sections)
# ---------------------------------------------------------------------------
def load_inputs():
    print("loading Accounts ...", flush=True)
    accounts = get("Accounts", {"select": '"Account Number","Strategic Partner","Practice ID","Practice Name","Market Segment","Intercompany","Account Manager Combined"'},
                   key='"Account Number"')
    print("loading Products, Dates, Incisive links, TRI rebills ...", flush=True)
    products = get("Products", {"select": '"Product Number","Product Name","Business Unit L1","Business Unit L2"'}, key='"Product Number"')
    dates = get("Dates", {"select": '"Date","Is Business Day"'}, key='"Date"')
    links = get("cs_incisive_links", {"select": "new_account,legacy_practice_id"})
    rebills = {r["case_number"] for r in get("tri_rebill_cases", {"select": "case_number"})}
    print("loading Cases (all history, five columns) ...", flush=True)
    cases = get("Cases", {"select": '"Case Number","Account Number","Received Date","Primary Product Number","LFX Unit Flag"'}, key='"Case Number"')
    print(f"loading Line Items received since {JAN1} ...", flush=True)
    lines = get("Line Items", {"select": '"Line Item Id","Case Number","Price Net"', '"Received Date"': f"gte.{JAN1.isoformat()}"}, key='"Line Item Id"')
    rev = defaultdict(float)
    for r in lines:
        if r.get("Case Number") and r.get("Price Net") is not None:
            rev[r["Case Number"]] += float(r["Price Net"])
    print(f"  {len(accounts):,} accounts, {len(products):,} products, {len(cases):,} cases, {len(lines):,} line items, {len(dates):,} calendar days", flush=True)
    return {"accounts": accounts, "products": products, "dates": dates, "links": links, "rebills": rebills, "cases": cases, "rev": rev}


def prepare(inputs):
    """Shared scope: exclusions, practice ids, product lines, counted cases."""
    legacy = {l["new_account"]: l["legacy_practice_id"] for l in inputs["links"] if l.get("new_account")}
    prod = {}
    for p in inputs["products"]:
        pn = p.get("Product Number")
        if pn and pn not in prod:
            prod[pn] = (line_of(p.get("Business Unit L1"), p.get("Business Unit L2")),
                        "manufacturing jig" in (p.get("Product Name") or "").lower())
    scope = {}          # account number -> {sp, pid, amc}
    excluded = defaultdict(int)
    for a in inputs["accounts"]:
        an = (a.get("Account Number") or "").strip()
        if not an:
            continue
        sp = (a.get("Strategic Partner") or "").strip()
        if an in CORP_EXCLUDE or (a.get("Market Segment") or "").strip() in SEG_EXCLUDE \
                or (a.get("Intercompany") or "").strip() == "Yes" or "(dds" in (a.get("Practice Name") or "").lower():
            excluded[sp or "(none)"] += 1
            continue
        pid = legacy.get(an) or (a.get("Practice ID") or "").strip()
        if not pid:                      # same rule as the pipeline: no practice id, not counted
            excluded[sp or "(none)"] += 1
            continue
        scope[an] = {"sp": sp, "pid": pid, "amc": (a.get("Account Manager Combined") or "").strip()}
    # who manages each Aspen store's Aspen Dental account (for the LFX routing)
    dental_owner = {}
    for an, s in scope.items():
        if s["sp"] == "Aspen Dental" and s["amc"] and not s["amc"].startswith("(x)"):
            dental_owner[s["pid"]] = s["amc"]
    # counted cases: (date, line, sp_effective, pid, amc_effective, case_number)
    counted = []
    seen = set()
    dropped = defaultdict(int)
    routed_lfx = 0
    for c in inputs["cases"]:
        an = (c.get("Account Number") or "").strip()
        s = scope.get(an)
        if not s:
            continue
        cn = c.get("Case Number")
        if not cn or cn in seen:
            continue
        seen.add(cn)
        if cn in inputs["rebills"]:
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
        sp, pid, amc = s["sp"], s["pid"], s["amc"]
        if sp == "Aspen Beacon" and (c.get("LFX Unit Flag") or "").strip() == "Yes":
            sp = "Aspen Dental"                          # LFX work billed to Beacon belongs to the Aspen Dental store
            amc = dental_owner.get(pid, "")
            routed_lfx += 1
        counted.append((d, line, sp, pid, amc, cn))
    print("dropped cases:", dict(dropped), "| Beacon LFX cases routed to Aspen Dental:", routed_lfx, flush=True)
    return {"scope": scope, "counted": counted, "excluded": excluded, "cal": BizCal(inputs["dates"]), "rev": inputs["rev"]}


# ---------------------------------------------------------------------------
# Account Executives
# ---------------------------------------------------------------------------
def build_ae(P):
    scope, counted = P["scope"], P["counted"]
    pids_by_partner = defaultdict(set)
    for s in scope.values():
        pids_by_partner[s["sp"]].add(s["pid"])
    aspen_stores = pids_by_partner["Aspen Dental"] | pids_by_partner["Aspen Beacon"]
    aspen_network = max(len(pids_by_partner["Aspen Dental"]), len(pids_by_partner["Aspen Beacon"]))
    universe = {"Aspen ClearChoice": pids_by_partner["Aspen ClearChoice"], "Aspen Dental": aspen_stores,
                "Aspen Beacon": aspen_stores, "MB2": pids_by_partner["MB2"]}
    ents = defaultdict(Entity)
    for d, line, sp, pid, amc, cn in counted:
        if sp in universe:
            ents[(sp, pid)].add(d, line)
    for e in ents.values():
        e.finish()

    months = ytd_months(RUN_DATE)
    snaps = [JAN1] + [s for _, _, s in months]      # Jan 1 = state at the end of December (baseline)
    cur_m0 = months[-1][1]
    subsections, validation = [], {}
    for pdef in PARTNERS:
        sp = pdef["partner"]
        ids = sorted(universe[sp])
        E = {pid: ents[(sp, pid)] for pid in ids if (sp, pid) in ents}
        lv = {pid: [E[pid].level(s) if pid in E else QUIET for s in snaps] for pid in ids}
        cur = [lv[pid][-1] for pid in ids]
        n_super = sum(1 for x in cur if x == SUPER)
        n_core = sum(1 for x in cur if x == CORE)
        n_dab = sum(1 for x in cur if x == DABBLER)
        ytd_sub = sum(1 for pid in ids if pid in E and E[pid].cases_between(JAN1, RUN_DATE) > 0)
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
        # week over week this quarter: where the practices sit at the end of each week
        bounds = quarter_bounds(RUN_DATE)
        lv_b = {pid: [E[pid].level(b) if pid in E else QUIET for b in bounds] for pid in ids}
        wk, counts = [], {"super": [], "core": [], "dabbler": [], "new": [], "inactive": []}
        for i in range(1, len(bounds)):
            a, b = bounds[i - 1], bounds[i]
            wk.append({"label": a.strftime("%b %d").replace(" 0", " "), "start": a.isoformat(), "partial": (b - a).days < 7})
            counts["super"].append(sum(1 for pid in ids if lv_b[pid][i] == SUPER))
            counts["core"].append(sum(1 for pid in ids if lv_b[pid][i] == CORE))
            counts["dabbler"].append(sum(1 for pid in ids if lv_b[pid][i] == DABBLER))
            counts["inactive"].append(sum(1 for pid in ids if lv_b[pid][i] == QUIET))
            counts["new"].append(sum(1 for pid in ids if pid in E and E[pid].first is not None and a <= E[pid].first < b))

        def deltas(v):
            return [None] + [v[j] - v[j - 1] for j in range(1, len(v))]
        state_rows = [
            ("super", "Super Active", "full bar in both 90 day windows", "good_up"),
            ("core", "Core Active", "half bar in the last 90 days", "good_up"),
            ("dabbler", "Dabbler", "a case in the last 90 days, below the bar", "neutral"),
            ("new", "New this week", "first ever case that week", "good_up"),
            ("inactive", "Inactive", "no case in the last 90 days", "good_down"),
        ]
        weekly_states = {"quarter": quarter_label(RUN_DATE), "weeks": wk,
                         "rows": [{"key": k, "label": lab, "hint": hint, "tone": tone, "values": counts[k], "deltas": deltas(counts[k])} for k, lab, hint, tone in state_rows]}
        subsections.append({
            "key": pdef["key"], "title": pdef["title"], "partner": sp, "ae": pdef["ae"], "logo": pdef["logo"],
            "network": network, "plays": list(PLAYS_PLACEHOLDER),
            "cards": cards, "months": mrows,
            "weekly_states": weekly_states,
            "transitions": {"months": [r["label"] for r in mrows],
                            "rows": [{"key": k, "label": lab, "hint": hint, "tone": tone, "values": tr[k]} for k, lab, hint, tone in row_defs],
                            "net": net},
        })
        validation[sp] = {"super": n_super, "core": n_core, "dabbler": n_dab, "quiet": len(ids) - n_super - n_core - n_dab,
                          "in_system": len(ids), "network": network, "excluded_accounts": P["excluded"].get(sp, 0)}
    print("AE practice state at run date (compare with cs_activity_state):", json.dumps(validation), flush=True)
    return {
        "as_of": RUN_DATE.isoformat(), "year": RUN_DATE.year,
        "definition": {
            "super_active": "full bar in one business unit in each of the last two 90 day windows (CB 60, REM 30, IMP 12, FA 12, HE 12)",
            "core_active": "half bar in one business unit in the last 90 days (CB 30, REM 15, IMP 6, FA 6, HE 6)",
            "dabbler": "at least one case in the last 90 days, below every bar",
            "new": "first ever case received in that month",
            "lfx": "LFX cases billed to an Aspen Beacon account count as Aspen Dental for that store; Aspen Beacon shows Beacon non-LFX cases",
        },
        "subsections": subsections,
    }


# ---------------------------------------------------------------------------
# Account Managers
# ---------------------------------------------------------------------------
def build_am(P):
    scope, counted, cal, rev = P["scope"], P["counted"], P["cal"], P["rev"]
    months = ytd_months(RUN_DATE)
    cur_m0 = months[-1][1]
    pm0 = prev_month(cur_m0)
    biz_in = cal.between(cur_m0, RUN_DATE)                       # business days elapsed this month (through yesterday)
    prior_days = set(cal.between(pm0, cur_m0)[:len(biz_in)])      # same number of business days into last month
    window60 = cal.between(RUN_DATE - dt.timedelta(days=60), RUN_DATE)
    q0 = dt.date(RUN_DATE.year, 3 * ((RUN_DATE.month - 1) // 3) + 1, 1)
    bounds = []
    b = q0
    while b < RUN_DATE:
        bounds.append(b)
        b += dt.timedelta(days=7)
    if bounds[-1] != RUN_DATE:
        bounds.append(RUN_DATE)
    s30 = RUN_DATE - dt.timedelta(days=30)

    # book membership
    book_of = {}
    for am in AMS:
        for name in am["amc"]:
            book_of[name] = am["key"]
    universe = defaultdict(set)
    for s in scope.values():
        k = book_of.get(s["amc"])
        if k:
            universe[k].add(s["pid"])
    ents = defaultdict(Entity)                 # (book, pid) -> Entity
    by_book = defaultdict(list)                # book -> [(date, pid, sp, cn)]
    for d, line, sp, pid, amc, cn in counted:
        k = book_of.get(amc)
        if not k:
            continue
        ents[(k, pid)].add(d, line)
        by_book[k].append((d, pid, sp, cn))
        universe[k].add(pid)
    for e in ents.values():
        e.finish()

    subsections = []
    for am in AMS:
        k = am["key"]
        ids = sorted(universe[k])
        E = {pid: ents[(k, pid)] for pid in ids if (k, pid) in ents}
        cases = by_book[k]
        # cards
        submitters_ytd = sum(1 for pid in ids if pid in E and E[pid].cases_between(JAN1, RUN_DATE) > 0)
        folded = [(cal.fold(d), pid, sp, cn) for d, pid, sp, cn in cases if d >= JAN1 - dt.timedelta(days=100)]
        cases_mtd = sum(1 for fd, _, _, _ in folded if cur_m0 <= fd < RUN_DATE)
        prior_pace = sum(1 for fd, _, _, _ in folded if fd in prior_days)
        mtd_pct = round(100.0 * (cases_mtd / prior_pace - 1), 1) if prior_pace else None
        lv_now = {pid: (E[pid].level(RUN_DATE) if pid in E else QUIET) for pid in ids}
        lv_30 = {pid: (E[pid].level(s30) if pid in E else QUIET) for pid in ids}
        promoted_30 = sum(1 for pid in ids if lv_30[pid] < CORE <= lv_now[pid])
        demoted_30 = sum(1 for pid in ids if lv_30[pid] >= CORE > lv_now[pid])
        active_now = sum(1 for pid in ids if lv_now[pid] >= CORE)
        # daily volume by business day, trailing 60 days
        per_day = defaultdict(int)
        for fd, _, _, _ in folded:
            per_day[fd] += 1
        daily = [{"d": d.isoformat(), "label": d.strftime("%b %-d") if os.name != "nt" else d.strftime("%b %d").replace(" 0", " "),
                  "n": per_day.get(d, 0), "monday": d.weekday() == 0} for d in window60]
        # revenue expansion: avg revenue per submitting office per month, by partner group
        if am["lines"] == "all":
            group_of = lambda sp: "All"
            groups = ["All"]
        elif am["lines"] == "top3":
            ytd_rev = defaultdict(float)
            for d, pid, sp, cn in cases:
                if d >= JAN1:
                    ytd_rev[sp or "(none)"] += rev.get(cn, 0.0)
            top = [sp for sp, _ in sorted(ytd_rev.items(), key=lambda x: -x[1])[:3]]
            group_of = lambda sp, top=top: sp if sp in top else "Other"
            groups = top + ["Other"]
        else:
            allowed = list(am["lines"])
            group_of = lambda sp, allowed=allowed: sp if sp in allowed else "Other"
            groups = allowed + (["Other"] if any(sp not in allowed for d, _, sp, _ in cases if d >= JAN1) else [])
        series = {g: {"name": g, "values": [], "offices": [], "revenue": []} for g in groups}
        for label, m0, s in months:
            offices = defaultdict(set)
            money = defaultdict(float)
            for d, pid, sp, cn in cases:
                if m0 <= d < s:
                    g = group_of(sp)
                    offices[g].add(pid)
                    money[g] += rev.get(cn, 0.0)
            for g in groups:
                n = len(offices[g])
                series[g]["offices"].append(n)
                series[g]["revenue"].append(int(round(money[g])))
                series[g]["values"].append(int(round(money[g] / n)) if n else None)
        # week over week this quarter
        lv_b = {pid: [E[pid].level(b) if pid in E else QUIET for b in bounds] for pid in ids}
        weeks = []
        for i in range(1, len(bounds)):
            up = sum(1 for pid in ids if lv_b[pid][i - 1] < CORE <= lv_b[pid][i])
            down = sum(1 for pid in ids if lv_b[pid][i - 1] >= CORE > lv_b[pid][i])
            start = bounds[i - 1]
            weeks.append({"label": start.strftime("%b %d").replace(" 0", " "), "start": start.isoformat(),
                          "partial": (bounds[i] - start).days < 7, "promoted": up, "demoted": down, "net": up - down})
        subsections.append({
            "key": k, "name": am["name"], "label": am["label"], "logos": am["logos"],
            "cards": {"practices": len(ids), "submitters_ytd": submitters_ytd, "active_now": active_now,
                      "cases_mtd": cases_mtd, "prior_pace": prior_pace, "mtd_pct": mtd_pct, "biz_days_in": len(biz_in),
                      "month_label": cur_m0.strftime("%b"), "prior_month_label": pm0.strftime("%b"),
                      "promoted_30": promoted_30, "demoted_30": demoted_30},
            "daily": {"days": daily, "total": sum(x["n"] for x in daily), "from": window60[0].isoformat() if window60 else None, "to": window60[-1].isoformat() if window60 else None},
            "revenue": {"months": [m[0] for m in months], "series": [series[g] for g in groups]},
            "weekly": {"quarter": f"Q{(RUN_DATE.month - 1) // 3 + 1} {RUN_DATE.year}", "weeks": weeks},
        })
        print(f"AM {am['name']:18s} practices={len(ids):5d} submittersYTD={submitters_ytd:4d} casesMTD={cases_mtd:5d} priorPace={prior_pace:5d} pct={mtd_pct} up30={promoted_30} down30={demoted_30} active={active_now} groups={groups}", flush=True)
    return {
        "as_of": RUN_DATE.isoformat(), "year": RUN_DATE.year,
        "definition": {
            "book": "practices whose accounts carry the manager in Accounts, Account Manager Combined; Syed carries the shared Incisive book, Nikolas his non-Incisive accounts",
            "pace": "cases MTD compared with the same number of business days into last month; weekend and holiday cases count on the business day before",
            "moves": "promoted = below active to Core or Super Active; demoted = Core or Super Active down to Dabbler or quiet",
            "revenue": "Line Items Price Net per case, attributed to the month the case was received, divided by practices that sent a case that month",
        },
        "subsections": subsections,
    }


def build_programs(P):
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
    P = prepare(load_inputs())
    data = {
        "meta": {
            "run_ts": now_utc.isoformat(timespec="seconds"),
            "run_date": RUN_DATE.isoformat(),
            "data_through": (RUN_DATE - DAY).isoformat(),
            "latest_invoice_date": latest_invoice_date(),
            "source": "Supabase SK Public",
        },
        "sections": {
            "ae": build_ae(P),
            "am": build_am(P),
            "programs": build_programs(P),
        },
    }
    body = "window.DCP_DATA = " + sanitize(json.dumps(data, ensure_ascii=True, separators=(",", ":"))) + ";\n"
    with open(os.path.abspath(out), "w", encoding="utf8", newline="\n") as f:
        f.write(body)
    print(f"wrote {os.path.abspath(out)} ({len(body):,} bytes); run date {RUN_DATE}; latest invoice date {data['meta']['latest_invoice_date']}")


if __name__ == "__main__":
    main()
