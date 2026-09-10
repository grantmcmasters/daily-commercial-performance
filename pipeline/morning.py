"""The morning job, run on the lab script computer by Windows Task Scheduler.

One run: pull the latest code, rebuild the data from the database, publish the data files (a git push, which is
what refreshes the live site), render the deck, write the AI note, send the email, and remember that today is done.
Every step retries. A failure after the retries emails an alert to MAIL_ALERT_TO (default: the sender) and exits 1,
so Task Scheduler's own restart-on-failure gets another go; the "already sent today" guard means retries and the
6:00 AM catch-up task can never send twice.

usage:  python pipeline/morning.py [--to a@b.com,c@d.com] [--dry-run] [--force] [--no-pull] [--no-publish]
  --to          send only to these addresses (a test); the sent marker is not written
  --dry-run     everything except the send: the message is written to out/<date>/email.eml; no marker
  --force       run even if today's email already went out
  --no-pull     do not git pull first (offline test)
  --no-publish  do not commit or push the data files

env, read from <repo>/.env (never committed) or the environment:
  SUPABASE_URL, SUPABASE_SERVICE_KEY          the database
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL           the note (model defaults to claude-fable-5-1, with fallbacks)
  MAIL_FROM, MAIL_PASSWORD, MAIL_TO            the mailbox and the recipients (comma separated)
  MAIL_SMTP_HOST, MAIL_SMTP_PORT               smtp.office365.com / 587 for the SK mailbox
  MAIL_ALERT_TO                                where failure alerts go (default MAIL_FROM)
  DCP_NODE                                     node.exe path when node is not on PATH
"""
import argparse
import datetime as dt
import json
import os
import shutil
import smtplib
import subprocess
import sys
import time
from email.message import EmailMessage

PIPE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(PIPE, ".."))
STATE = os.path.join(ROOT, "state")
OUT_ROOT = os.path.join(ROOT, "out")
DATA_FILES = ["data.js", "details.js", "directory.js", "health"]
GIT_ID = ["-c", "user.name=sk-refresh", "-c", "user.email=actions@users.noreply.github.com"]
LOG_LINES = []


def log(msg):
    line = f"[{dt.datetime.now():%H:%M:%S}] {msg}"
    print(line, flush=True)
    LOG_LINES.append(line)


def load_env(path):
    """KEY=value lines into os.environ (the environment wins when a key is already set)"""
    if not os.path.exists(path):
        return 0
    n = 0
    for line in open(path, encoding="utf8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v
            n += 1
    return n


def pacific_now():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:  # noqa: BLE001  (no tz database: fall back to the machine clock, which is Pacific on the lab machine)
        return dt.datetime.now()


def run(cmd, retries=1, wait=60, timeout=1200, cwd=ROOT, env=None, label=None):
    """Run a command with retries. Returns (ok, output)."""
    label = label or " ".join(str(c) for c in cmd[:3])
    last = ""
    for attempt in range(1, retries + 1):
        try:
            p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf8", errors="replace", timeout=timeout)
            last = (p.stdout or "") + (p.stderr or "")
            if p.returncode == 0:
                return True, last
            log(f"{label}: exit {p.returncode} on attempt {attempt}/{retries}\n" + "\n".join(last.strip().splitlines()[-8:]))
        except subprocess.TimeoutExpired:
            last = f"timed out after {timeout}s"
            log(f"{label}: {last} on attempt {attempt}/{retries}")
        except OSError as e:
            last = str(e)
            log(f"{label}: {e}")
            return False, last
        if attempt < retries:
            time.sleep(wait)
    return False, last


def git(*args, **kw):
    return run(["git"] + GIT_ID + list(args), **kw)


def find_node():
    for cand in [os.environ.get("DCP_NODE"), shutil.which("node"), r"C:\Program Files\nodejs\node.exe"]:
        if cand and os.path.exists(cand):
            return cand
    return None


def alert(subject, body):
    """A plain text failure email to MAIL_ALERT_TO (or the sender); never raises."""
    sender, pw = os.environ.get("MAIL_FROM", ""), os.environ.get("MAIL_PASSWORD", "")
    to = [x.strip() for x in (os.environ.get("MAIL_ALERT_TO") or sender).split(",") if x.strip()]
    if not (sender and pw and to):
        log("alert not sent: MAIL_FROM / MAIL_PASSWORD missing")
        return
    host, port = os.environ.get("MAIL_SMTP_HOST", "smtp.office365.com"), int(os.environ.get("MAIL_SMTP_PORT", "587"))
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, ", ".join(to), subject
    msg.set_content(body)
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=60) as s:
                s.login(sender, pw); s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=60) as s:
                s.ehlo(); s.starttls(); s.ehlo(); s.login(sender, pw); s.send_message(msg)
        log(f"alert sent to {', '.join(to)}")
    except Exception as e:  # noqa: BLE001
        log(f"alert failed: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-pull", action="store_true")
    ap.add_argument("--no-publish", action="store_true")
    a = ap.parse_args()

    os.makedirs(STATE, exist_ok=True)
    n = load_env(os.path.join(ROOT, ".env"))
    now = pacific_now()
    today = now.date().isoformat()
    out = os.path.join(OUT_ROOT, today)
    os.makedirs(out, exist_ok=True)
    log(f"morning job start: {now:%A %B %d, %Y %H:%M} Pacific, repo {ROOT}, {n} settings from .env, python {sys.version.split()[0]}")

    # already done today? (retries and the catch-up task land here)
    marker = os.path.join(STATE, "last_sent.txt")
    if not a.force and not a.to and not a.dry_run and os.path.exists(marker) and open(marker).read().strip() == today:
        log("today's email already went out; nothing to do")
        return 0
    # another run in progress?
    lock = os.path.join(STATE, "running.lock")
    if os.path.exists(lock) and time.time() - os.path.getmtime(lock) < 90 * 60:
        log("another run started less than 90 minutes ago and has not finished; leaving it alone")
        return 0
    open(lock, "w").write(f"{os.getpid()} {now.isoformat()}")

    failed_step, notes = None, []
    try:
        # 1. the latest code: fetch, then make the tree exactly origin/main (a leftover from a failed publish is rebuilt anyway)
        if not a.no_pull:
            ok, o = git("fetch", "origin", "main", retries=3, wait=60, timeout=300, label="git fetch")
            if ok:
                ok, o = git("reset", "-q", "--hard", "origin/main", retries=1, timeout=120, label="git reset")
            if ok:
                okh, h = git("rev-parse", "--short", "HEAD", retries=1, timeout=60, label="git rev-parse")
                log("code: at " + (h.strip() if okh else "origin/main"))
            else:
                notes.append("git fetch failed; ran with the code already on the machine")

        # 2. rebuild the data (build.py retries the database itself; this retries the whole build)
        env = dict(os.environ, DCP_OUT=os.path.join(ROOT, "data.js"), PYTHONUTF8="1")
        ok, o = run([sys.executable, os.path.join(PIPE, "build.py")], retries=3, wait=120, timeout=1500, env=env, label="rebuild")
        if ok:
            tail = [ln for ln in o.strip().splitlines() if ln.startswith("wrote ")]
            log("rebuild: " + (tail[-1][:120] if tail else "done"))
        else:
            notes.append("rebuild failed after 3 attempts; the email carries the last good data")

        # 3. publish the data files (the live site refreshes from the push)
        if ok and not a.no_publish:
            git("add", "--", *DATA_FILES, retries=1, timeout=120)
            staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT, capture_output=True).returncode != 0
            if not staged:
                log("publish: the data files did not change")
            else:
                ok2, o2 = git("commit", "-q", "-m", f"Daily refresh {today}", retries=1, timeout=120, label="git commit")
                pushed = False
                for attempt in range(1, 4):
                    ok3, o3 = git("push", "origin", "main", retries=1, timeout=300, label="git push")
                    if ok3:
                        pushed = True
                        break
                    git("pull", "--rebase", "-X", "theirs", "origin", "main", retries=1, timeout=300, label="git pull before push")
                    time.sleep(30)
                log("publish: pushed" if pushed else "publish: push failed after 3 attempts")
                if not pushed:
                    notes.append("git push failed; the live site did not refresh (the email still went out)")

        # 4. yesterday's data for the day over day comparison: the last data.js committed before midnight Pacific
        prev = os.path.join(out, "prev.js")
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        okp, h = git("log", "--format=%H", "-n", "1", f"--before={midnight}", "--", "data.js", retries=1, timeout=120, label="git log")
        h = h.strip().splitlines()[0] if okp and h.strip() else ""
        if h:
            okp, body = git("show", f"{h}:data.js", retries=1, timeout=120, label="git show")
            if okp:
                open(prev, "w", encoding="utf8").write(body)
                log(f"comparison: data.js from {h[:7]}")
        if not os.path.exists(prev):
            log("comparison: no earlier data.js; the note has no day over day line")

        # 5. the deck
        node = find_node()
        if not node:
            failed_step = "deck"; raise RuntimeError("node.exe not found (install Node.js LTS or set DCP_NODE in .env)")
        deck = os.path.join(out, "deck.pdf")
        ok, o = run([node, os.path.join(PIPE, "export_deck.js"), deck], retries=2, wait=30, timeout=600, label="deck")
        if not ok:
            failed_step = "deck"; raise RuntimeError(o[-2000:])
        log(f"deck: {os.path.getsize(deck):,} bytes")

        # 6. the note
        summary_md = os.path.join(out, "summary.md")
        cmd = [sys.executable, os.path.join(PIPE, "summarize.py"), "--today", os.path.join(ROOT, "data.js"), "--out", summary_md]
        if os.path.exists(prev):
            cmd += ["--yesterday", prev]
        ok, o = run(cmd, retries=2, wait=60, timeout=600, env=dict(os.environ, PYTHONUTF8="1"), label="note")
        if not ok:
            failed_step = "note"; raise RuntimeError(o[-2000:])
        summary_html = os.path.splitext(summary_md)[0] + ".html"
        if not os.path.exists(summary_html):
            failed_step = "note"; raise RuntimeError("summarize.py wrote no summary.html")
        log("note: " + ("with the AI draft" if "AI draft unavailable" not in open(summary_html, encoding="utf8").read() else "FALLBACK note (the model was unavailable)"))

        # 7. the email
        cmd = [sys.executable, os.path.join(PIPE, "send_mail.py"), "--summary", summary_html, "--pdf", deck]
        if a.to:
            cmd += ["--to", a.to]
        if a.dry_run:
            cmd += ["--dry-run"]
        ok, o = run(cmd, retries=3, wait=90, timeout=300, env=dict(os.environ, PYTHONUTF8="1"), cwd=out, label="send")
        if not ok:
            failed_step = "send"; raise RuntimeError(o[-2000:])
        log("send: " + (o.strip().splitlines()[-1] if o.strip() else "done"))
        if a.dry_run:
            eml = os.path.join(ROOT, "email.eml")
            if os.path.exists(eml):
                shutil.move(eml, os.path.join(out, "email.eml"))
        elif not a.to:
            open(marker, "w").write(today)
        json.dump({"date": today, "finished": pacific_now().isoformat(), "ok": True, "notes": notes, "dry_run": a.dry_run, "to": a.to},
                  open(os.path.join(STATE, "last_run.json"), "w"), indent=1)
        if notes:
            log("done with warnings: " + "; ".join(notes))
            alert(f"Daily Commercial morning job: sent with a warning ({today})", "The email went out, but:\n- " + "\n- ".join(notes) + "\n\nLog:\n" + "\n".join(LOG_LINES[-40:]))
        else:
            log("done")
        return 0
    except Exception as e:  # noqa: BLE001
        step = failed_step or "unknown"
        log(f"FAILED at {step}: {e}")
        json.dump({"date": today, "finished": pacific_now().isoformat(), "ok": False, "step": step, "error": str(e)[:2000], "notes": notes},
                  open(os.path.join(STATE, "last_run.json"), "w"), indent=1)
        alert(f"Daily Commercial morning job FAILED at {step} ({today})", f"Step: {step}\n\n{e}\n\nLog:\n" + "\n".join(LOG_LINES[-40:]) +
              "\n\nTask Scheduler retries every 15 minutes up to 4 times, then the 6:00 AM catch-up task tries once more. Run C:\\DailyCommercial\\run_morning.bat by hand after fixing the cause.")
        return 1
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
