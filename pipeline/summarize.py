"""Morning summary for the Daily Commercial Performance email.

Builds a compact digest from data.js (today) and, when available, yesterday's data.js, then asks Claude for a
short executive summary.  Writes summary.md and summary.html next to the output path.  If the API is not
reachable the summary falls back to a plain list of the headline numbers, so the email still goes out.

usage: python pipeline/summarize.py [--today data.js] [--yesterday prev.js] [--out summary.md] [--dry-run]
env:   ANTHROPIC_API_KEY (required unless --dry-run), ANTHROPIC_MODEL (default claude-sonnet-5)
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    if not path or not os.path.exists(path):
        return None
    s = open(path, encoding="utf8").read()
    return json.loads(s[s.index("{"):s.rindex("}") + 1])


def long_date(iso):
    try:
        d = dt.date.fromisoformat(iso)
        return d.strftime("%b %d, %Y").replace(" 0", " ")
    except Exception:
        return iso


def digest(d):
    """The numbers the summary may use, nothing else (no practice names, no case level detail)."""
    out = {"data_through": d.get("meta", {}).get("data_through"), "account_executives": [], "account_managers": [], "programs": []}
    for s in d.get("sections", {}).get("ae", {}).get("subsections", []):
        c = s["cards"]
        months = s.get("months") or []
        out["account_executives"].append({
            "partner": s["title"], "owner": s.get("ae"), "network": c.get("total"), "active": c.get("active"),
            "dabblers": c.get("dabblers"), "penetration_pct": c.get("penetration_pct"), "mtd_net_new_submitters": c.get("mtd_net_new"),
            "submitters_this_month": months[-1]["total"] if months else None, "submitters_last_month": months[-2]["total"] if len(months) > 1 else None,
        })
    for s in d.get("sections", {}).get("am", {}).get("subsections", []):
        c, r, wk = s["cards"], s.get("retention") or {}, (s.get("weekly") or {}).get("weeks") or []
        last = wk[-1] if wk else {}
        out["account_managers"].append({
            "name": s["name"], "book": s.get("label"), "submitters_ytd": c.get("submitters_ytd"),
            "cases_per_business_day_mtd": c.get("avg_per_day_mtd"), "cases_per_business_day_last_month": c.get("avg_per_day_prior"),
            "pace_pct_vs_last_month": c.get("avg_pct"), "cases_mtd": c.get("cases_mtd"),
            "became_active_l30d": c.get("promoted_30"), "lost_active_l30d": c.get("demoted_30"), "active_now": c.get("active_now"),
            "book_maintenance": {"quarter": r.get("quarter"), "active_at_start": r.get("start_active"), "still_active": r.get("stayed"),
                                 "now_dabbler": r.get("to_dabbler"), "now_inactive": r.get("to_inactive"), "pct": r.get("retained_pct")},
            "revenue_stability": {"prior_quarter": r.get("prev_quarter"), "prior_quarter_revenue": (r.get("revenue") or {}).get("base"),
                                  "qtd_revenue": (r.get("revenue") or {}).get("qtd"), "run_rate": (r.get("revenue") or {}).get("run_rate"),
                                  "pct_at_run_rate": (r.get("revenue") or {}).get("pct_run_rate")},
            "latest_week": {"label": last.get("label"), "up_to_active": last.get("promoted"), "core_to_super": last.get("up_super"),
                            "down_from_active": last.get("demoted"), "dabbler_to_inactive": last.get("down_quiet"), "net": last.get("net")},
        })
    for s in d.get("sections", {}).get("programs", {}).get("subsections", []):
        c, months = s["cards"], s.get("months") or []
        out["programs"].append({
            "program": s["title"], "submitters_ytd": c.get("submitters_ytd"), "active": c.get("active"), "dabblers": c.get("dabblers"),
            "inactive": c.get("gone_quiet"), "practices_in_book": c.get("practices"), "penetration_pct": c.get("penetration_pct"),
            "this_month": {"label": months[-1]["label"], "new": months[-1]["new"], "became_inactive": months[-1].get("gone_quiet"), "total_submitters": months[-1].get("submitters")} if months else None,
            "last_month": {"label": months[-2]["label"], "new": months[-2]["new"], "became_inactive": months[-2].get("gone_quiet"), "total_submitters": months[-2].get("submitters")} if len(months) > 1 else None,
        })
    return out


SYSTEM = (
    "You write the morning note that goes on top of Spectrum Killian's Daily Commercial Performance deck. "
    "Readers are the CEO and the commercial team. Write in plain, confident English. "
    "Use only the numbers in the digest; never invent, estimate or extrapolate beyond what is there. "
    "Do not name individual practices or patients. Do not use em dashes or en dashes; use commas or periods. "
    "Refer to people by first name after the first mention. Percent figures are whole numbers. "
    "Format: one opening sentence with the date the data runs through, then 6 to 8 short bullets, then one closing sentence naming the single thing to act on today. "
    "Bullets should cover: cases per business day pace by account manager (call out the biggest gains and drops against last month), "
    "active book maintenance and revenue stability (flag anything below 80% maintenance or 90% revenue stability), "
    "the latest week over week net moves, partner penetration and MTD net new submitters, and the program picture (new versus became inactive). "
    "When yesterday's digest is present, lead with what changed since yesterday. Output plain text with '- ' bullets, no markdown headings."
)


def call_claude(today, yesterday, model, key):
    body = {
        "model": model, "max_tokens": 1200, "system": SYSTEM,
        "messages": [{"role": "user", "content": "Today's digest:\n" + json.dumps(today, indent=1) + ("\n\nYesterday's digest:\n" + json.dumps(yesterday, indent=1) if yesterday else "\n\n(No digest from yesterday.)")}],
    }
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode("utf8"), method="POST",
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read().decode("utf8"))
    return "".join(part.get("text", "") for part in res.get("content", []) if part.get("type") == "text").strip()


def fallback(today):
    lines = [f"Daily Commercial Performance, data through {long_date(today.get('data_through'))}. The summary service was unavailable, so here are the headline numbers."]
    for a in today["account_managers"]:
        pace = a["pace_pct_vs_last_month"]
        bm, rs = a['book_maintenance']['pct'], a['revenue_stability']['pct_at_run_rate']
        lines.append(f"- {a['name']}: {round(a['cases_per_business_day_mtd'] or 0)} cases per business day MTD ({'+' if (pace or 0) > 0 else ''}{round(pace) if pace is not None else 'n/a'}% vs last month), "
                     f"book maintenance {round(bm) if bm is not None else 'n/a'}%, revenue stability {round(rs) if rs is not None else 'n/a'}% at run rate.")
    for p in today["account_executives"]:
        lines.append(f"- {p['partner']}: {p['active']} active of {p['network']} ({p['penetration_pct']}% penetration), {p['mtd_net_new_submitters']} net new submitters MTD.")
    for g in today["programs"]:
        tm = g["this_month"] or {}
        lines.append(f"- {g['program']}: {g['active']} active, {g['dabblers']} dabblers, {g['inactive']} inactive; this month +{tm.get('new')} new, -{tm.get('became_inactive')} inactive.")
    return "\n".join(lines)


def to_html(text):
    out, in_list = [], False
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        if ln.startswith("- ") or ln.startswith("• "):
            if not in_list:
                out.append('<ul style="margin:8px 0 12px 20px;padding:0">')
                in_list = True
            out.append('<li style="margin:0 0 7px 0">' + html.escape(ln[2:]) + "</li>")
        else:
            if in_list:
                out.append("</ul>")
                in_list = False
            out.append('<p style="margin:0 0 10px 0">' + html.escape(ln) + "</p>")
    if in_list:
        out.append("</ul>")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=os.path.join(ROOT, "data.js"))
    ap.add_argument("--yesterday", default=None)
    ap.add_argument("--out", default=os.path.join(ROOT, "summary.md"))
    ap.add_argument("--dry-run", action="store_true", help="skip the API and write the fallback summary")
    args = ap.parse_args()
    today_raw = load(args.today)
    if not today_raw:
        print("no data.js to summarize", file=sys.stderr)
        sys.exit(1)
    today = digest(today_raw)
    yest_raw = load(args.yesterday)
    yesterday = digest(yest_raw) if yest_raw and yest_raw.get("meta", {}).get("data_through") != today["data_through"] else None
    text = None
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not args.dry_run and key:
        try:
            text = call_claude(today, yesterday, os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"), key)
        except Exception as e:  # noqa: BLE001
            print("summary API failed:", e, file=sys.stderr)
    if not text:
        text = fallback(today)
    text = text.replace("—", ", ").replace("–", "-")
    open(args.out, "w", encoding="utf8").write(text + "\n")
    open(re.sub(r"\.md$", "", args.out) + ".html", "w", encoding="utf8").write(to_html(text))
    print(text)


if __name__ == "__main__":
    main()
