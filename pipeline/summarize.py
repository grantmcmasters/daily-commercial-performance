"""Morning note for the Daily Commercial Performance email.

Builds a numbers-only digest from data.js (today) and, when available, yesterday's data.js, asks Claude for a
structured note (one line story, two or three insights per section, one action) and renders it as the email
body.  Writes summary.json, summary.html (the body) and summary.md (plain text) next to --out.  If the API
is not reachable the note falls back to the headline numbers so the email still goes out.

usage: python pipeline/summarize.py [--today data.js] [--yesterday prev.js] [--out summary.md] [--dry-run]
env:   ANTHROPIC_API_KEY (required unless --dry-run), ANTHROPIC_MODEL (default claude-fable-5-1)
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    if not path or not os.path.exists(path):
        return None
    s = open(path, encoding="utf8").read()
    return json.loads(s[s.index("{"):s.rindex("}") + 1])


def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def pretty_date(iso):
    try:
        d = dt.date.fromisoformat(iso)
        return f"{d.strftime('%B')} {ordinal(d.day)}, {d.year}"
    except Exception:
        return iso


def tail(lst, n):
    return lst[-n:] if lst else []


def digest(d):
    """The numbers the note may use, nothing else (no practice names, no case level detail)."""
    out = {"data_through": d.get("meta", {}).get("data_through"), "account_executives": [], "account_managers": [], "programs": []}
    for s in d.get("sections", {}).get("ae", {}).get("subsections", []):
        c, months = s["cards"], s.get("months") or []
        st = ((s.get("states") or {}).get("year_month") or {})
        latest = {}
        for r in st.get("rows", []):
            latest[r["label"]] = {"count": r["values"][-1], "change_vs_prior_month": r["deltas"][-1]} if r.get("values") else None
        out["account_executives"].append({
            "partner": s["title"], "owner": s.get("ae"), "network": c.get("total"), "active": c.get("active"),
            "dabblers": c.get("dabblers"), "penetration_pct_active_over_network": c.get("penetration_pct"), "mtd_net_new_submitters": c.get("mtd_net_new"),
            "submitting_practices_by_month": [{"month": m["label"], "total": m["total"], "new": m["new"], "active": m["active"], "dabbler": m["dabbler"]} for m in tail(months, 4)],
            "state_at_latest_month_end": latest,
        })
    for s in d.get("sections", {}).get("am", {}).get("subsections", []):
        c, r, wk, rv = s["cards"], s.get("retention") or {}, (s.get("weekly") or {}).get("weeks") or [], s.get("revenue") or {}
        series = (rv.get("series") or [{}])[0]
        out["account_managers"].append({
            "name": s["name"], "book": s.get("label"), "submitters_ytd": c.get("submitters_ytd"), "active_now": c.get("active_now"),
            "cases_per_business_day_mtd": c.get("avg_per_day_mtd"), "cases_per_business_day_last_month": c.get("avg_per_day_prior"),
            "pace_pct_vs_last_month": c.get("avg_pct"), "cases_mtd": c.get("cases_mtd"), "business_days_elapsed": c.get("biz_days_in"),
            "became_active_l30d": c.get("promoted_30"), "lost_active_l30d": c.get("demoted_30"),
            "active_book_maintenance": {"quarter": r.get("quarter"), "active_at_quarter_start": r.get("start_active"), "still_active": r.get("stayed"),
                                        "now_dabbler": r.get("to_dabbler"), "now_inactive": r.get("to_inactive"), "pct": r.get("retained_pct")},
            "revenue_stability": {"prior_quarter": r.get("prev_quarter"), "prior_quarter_revenue": (r.get("revenue") or {}).get("base"),
                                  "qtd_revenue": (r.get("revenue") or {}).get("qtd"), "run_rate": (r.get("revenue") or {}).get("run_rate"),
                                  "pct_at_run_rate": (r.get("revenue") or {}).get("pct_run_rate")},
            "revenue_per_invoiced_practice_by_month": [{"month": m, "value": v} for m, v in zip(tail(rv.get("months") or [], 4), tail(series.get("values") or [], 4))],
            "cases_per_invoiced_practice_by_month": [{"month": m, "value": v} for m, v in zip(tail(rv.get("months") or [], 4), tail(rv.get("cases_per_office") or [], 4))],
            "recent_weeks": [{"week_of": w.get("label"), "up_to_active": w.get("promoted"), "core_to_super": w.get("up_super"),
                              "down_from_active": w.get("demoted"), "dabbler_to_inactive": w.get("down_quiet"), "net": w.get("net"), "partial_week": w.get("partial")} for w in tail(wk, 3)],
        })
    for s in d.get("sections", {}).get("programs", {}).get("subsections", []):
        c, months, wk = s["cards"], s.get("months") or [], (s.get("weekly") or {}).get("weeks") or []
        out["programs"].append({
            "program": s["title"], "submitters_ytd": c.get("submitters_ytd"), "active": c.get("active"), "dabblers": c.get("dabblers"),
            "inactive_submitted_this_year_but_quiet_90_days": c.get("gone_quiet"), "practices_in_book": c.get("practices"), "penetration_pct": c.get("penetration_pct"),
            "by_month": [{"month": m["label"], "new_submitters": m["new"], "became_inactive": m.get("gone_quiet"), "net": (m["new"] or 0) - (m.get("gone_quiet") or 0), "total_submitters": m.get("submitters")} for m in tail(months, 4)],
            "recent_weeks": [{"week_of": w.get("label"), "up_to_active": w.get("promoted"), "down_from_active": w.get("demoted"), "dabbler_to_inactive": w.get("down_quiet"), "net": w.get("net")} for w in tail(wk, 3)],
        })
    return out


SYSTEM = """You write the short morning note that goes out with Spectrum Killian's Daily Commercial Performance deck. Readers are the CEO and the commercial team. Think sharp analyst, not storyteller.

Voice and tone:
- Constructive and positive. Celebrate what is working with the number that proves it. When a book is behind, describe the book and the numbers, never the person: "Collin's book: 64% active book maintenance, 18 practices lost vs 7 gained in 30 days" is right; "Collin is the laggard" is wrong.
- Never criticize, rank or label a person. No words like laggard, worst, weak, erosion, masking, unhealthy, flat tire, deserves attention. No metaphors, no narrative, no drama.
- Every bullet ties to objective numbers from the digest and, where useful, the opportunity they point to.

Format, keep it insanely simple:
- Exactly two insights per section. Each is ONE plain sentence of 8 to 14 words: a fact with its number. No adjectives, no interpretation, no second clause.
- The headline is one sentence under 14 words: the single most important number of the day.
- The action is one sentence under 14 words.
- Wrap the one key number or name in each insight in **double asterisks**. One per insight.
- Whole-number percents. Full name once, then first name. Never name individual practices or patients.
- No em dashes or en dashes; use commas or periods. No bullet symbols in the text itself.
- Use only the numbers in the digest; never invent or extrapolate. When yesterday's digest is present, lead with what changed since yesterday.

Definitions: Active = Core or Super Active (past the half or full case bar in the last 90 days). Dabbler = a case in the last 90 days, below the bar. Inactive = nothing in 90 days. Cases per business day MTD compares with last month's average. Active book maintenance = practices active at quarter start that are still active. Revenue stability = the same practices' invoiced revenue this quarter at run rate over the prior quarter (100% or better is green, 90% gold, below 90% red). Penetration = currently active over the network.

Return ONLY a JSON object, no code fences, with exactly these keys:
{"headline": "one sentence", "account_executives": ["insight", "insight", "insight (optional)"], "account_managers": ["insight", "insight", "insight (optional)"], "programs": ["insight", "insight", "insight (optional)"], "action": "one sentence naming the single most useful thing to do today, framed as an opportunity"}"""


MODEL_CHAIN = ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-sonnet-4-6"]


def call_claude(today, yesterday, model, key):
    body = {
        "model": model, "max_tokens": 2000, "system": SYSTEM,
        "messages": [{"role": "user", "content": "Today's digest:\n" + json.dumps(today, indent=1) + ("\n\nYesterday's digest:\n" + json.dumps(yesterday, indent=1) if yesterday else "\n\n(No digest from yesterday.)")}],
    }
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode("utf8"), method="POST",
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            res = json.loads(r.read().decode("utf8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} from the API for {model}: {e.read().decode('utf8', 'replace')[:300]}") from None
    text = "".join(part.get("text", "") for part in res.get("content", []) if part.get("type") == "text").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    note = json.loads(text[text.index("{"):text.rindex("}") + 1])
    for k in ("headline", "account_executives", "account_managers", "programs", "action"):
        if k not in note:
            raise ValueError("note missing " + k)
    return note


def pct(v):
    return "n/a" if v is None else f"{round(v)}%"


def fallback(today):
    ams = sorted(today["account_managers"], key=lambda a: -(a["pace_pct_vs_last_month"] or 0))
    top, low = ams[0], ams[-1]
    weak = [a for a in today["account_managers"] if (a["active_book_maintenance"]["pct"] or 100) < 80 or (a["revenue_stability"]["pct_at_run_rate"] or 100) < 90]
    aes = sorted(today["account_executives"], key=lambda p: -(p["mtd_net_new_submitters"] or 0))
    note = {
        "headline": "The AI note was unavailable this morning, so this is the headline numbers only; the reason is at the bottom of the email.",
        "account_executives": [f"**{p['partner']}** has {p['active']} active practices of {p['network']} ({pct(p['penetration_pct_active_over_network'])} penetration) and {p['mtd_net_new_submitters']} net new submitters this month." for p in aes[:3]],
        "account_managers": [
            f"**{top['name']}** has the strongest pace at {round(top['cases_per_business_day_mtd'] or 0)} cases per business day, {'+' if (top['pace_pct_vs_last_month'] or 0) > 0 else ''}{round(top['pace_pct_vs_last_month'] or 0)}% against last month; {low['name']}'s book is at {round(low['pace_pct_vs_last_month'] or 0)}% and has the most room to add.",
            (f"Books below the maintenance or revenue thresholds, where the upside is: " + ", ".join(f"**{a['name']}** ({pct(a['active_book_maintenance']['pct'])} book maintenance, {pct(a['revenue_stability']['pct_at_run_rate'])} revenue stability)" for a in weak[:3]) + ".") if weak else "Every book is at or above the maintenance and revenue stability thresholds.",
        ],
        "programs": [f"**{g['program']}**: {g['active']} active, {g['dabblers']} dabblers, {g['inactive_submitted_this_year_but_quiet_90_days']} inactive this year; this month {g['by_month'][-1]['new_submitters']} new against {g['by_month'][-1]['became_inactive']} gone inactive." for g in today["programs"]],
        "action": "Open the deck for the detail behind these numbers.",
    }
    return note


NAVY, DENTAL, GRAY = "#052030", "#4ABEEE", "#5A6B79"


def rich(text):
    """escape, then **bold** markers to navy bold"""
    t = html.escape(str(text))
    return re.sub(r"\*\*(.+?)\*\*", r'<b style="color:' + NAVY + r'">\1</b>', t)


def render_html(note, data_through):
    p = 'style="margin:0 0 12px 0"'
    h = f'style="margin:22px 0 10px 0;font-size:12.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:{NAVY};border-bottom:2px solid {DENTAL};padding-bottom:5px"'
    story = rich(note["headline"]).replace('<b style="color:' + NAVY + '">', "").replace("</b>", "")
    parts = [f"<p {p}>Good morning team,</p>",
             f'<p {p}>Data through {html.escape(pretty_date(data_through))}. <b style="color:{NAVY}">{story}</b></p>']
    for title, key in (("Account Executives", "account_executives"), ("Account Managers", "account_managers"), ("Programs", "programs")):
        parts.append(f"<p {h}>{title}</p>")
        parts.append('<ul style="margin:0 0 6px 22px;padding:0">' + "".join(f'<li style="margin:0 0 7px 0">{rich(ins)}</li>' for ins in (note.get(key) or [])[:3]) + "</ul>")
    parts.append(f'<p style="margin:20px 0 12px 0;padding:10px 14px;background:#F3F9FD;border-left:4px solid {NAVY}"><b style="color:{NAVY}">Today:</b> {rich(note.get("action", ""))}</p>')
    if note.get("error"):
        parts.append(f'<p style="margin:0 0 12px 0;color:#B0362F;font-size:12px">AI draft unavailable this morning: {html.escape(str(note["error"]))}</p>')
    return "\n".join(parts)


def render_text(note, data_through):
    lines = ["Good morning team,", "", f"Data through {pretty_date(data_through)}. {note['headline']}", ""]
    for title, key in (("Account Executives", "account_executives"), ("Account Managers", "account_managers"), ("Programs", "programs")):
        lines.append(title.upper())
        lines.extend("- " + str(x).replace("**", "") for x in (note.get(key) or [])[:3])
        lines.append("")
    lines.append("Today: " + str(note.get("action", "")).replace("**", ""))
    return "\n".join(lines)


def clean(note):
    def fix(s):
        return str(s).replace("—", ", ").replace("–", "-")
    out = {"headline": fix(note["headline"]), "action": fix(note.get("action", ""))}
    for k in ("account_executives", "account_managers", "programs"):
        out[k] = [fix(x) for x in (note.get(k) or []) if str(x).strip()][:2]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=os.path.join(ROOT, "data.js"))
    ap.add_argument("--yesterday", default=None)
    ap.add_argument("--out", default=os.path.join(ROOT, "summary.md"))
    ap.add_argument("--dry-run", action="store_true", help="skip the API and write the fallback note")
    args = ap.parse_args()
    today_raw = load(args.today)
    if not today_raw:
        print("no data.js to summarize", file=sys.stderr)
        sys.exit(1)
    today = digest(today_raw)
    yest_raw = load(args.yesterday)
    yesterday = digest(yest_raw) if yest_raw and yest_raw.get("meta", {}).get("data_through") != today["data_through"] else None
    note, error = None, None
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not args.dry_run and key:
        chain = [os.environ.get("ANTHROPIC_MODEL") or MODEL_CHAIN[0]] + [m for m in MODEL_CHAIN if m != os.environ.get("ANTHROPIC_MODEL")]
        for model in chain:
            try:
                note = call_claude(today, yesterday, model, key)
                print("note written by", model, file=sys.stderr)
                break
            except Exception as e:  # noqa: BLE001
                error = f"{model}: {e}"
                print("summary API failed for", error, file=sys.stderr)
    elif not args.dry_run:
        error = "ANTHROPIC_API_KEY secret is missing"
    if not note:
        note = fallback(today)
        note["error"] = error or "dry run"
    err = note.get("error")
    note = clean(note)
    if err and not args.dry_run:
        note["error"] = str(err)[:240]
    base = re.sub(r"\.md$", "", args.out)
    open(base + ".json", "w", encoding="utf8").write(json.dumps(note, indent=1))
    open(base + ".html", "w", encoding="utf8").write(render_html(note, today["data_through"]))
    text = render_text(note, today["data_through"])
    open(args.out, "w", encoding="utf8").write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
