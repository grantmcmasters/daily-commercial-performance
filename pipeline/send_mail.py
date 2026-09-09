"""Send the morning email: the summary in the body, the deck attached, a link to the live page.

Two ways to send, picked from the environment:
  * Microsoft Graph (preferred for a Microsoft 365 mailbox): set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET for an app
    registration with the Mail.Send application permission, and MAIL_FROM = the mailbox to send from.
  * SMTP (Gmail app password by default; smtp.office365.com on 587 if the tenant still allows SMTP AUTH): MAIL_FROM,
    MAIL_PASSWORD, optional MAIL_SMTP_HOST (smtp.gmail.com) and MAIL_SMTP_PORT (465 = SSL, 587 = STARTTLS).

usage: python pipeline/send_mail.py [--summary summary.html] [--pdf deck.pdf] [--to a@x.com,b@y.com] [--dry-run]
env:   MAIL_TO (comma separated) plus one of the sets above; optional MAIL_SUBJECT_PREFIX, DCP_URL
"""
import argparse
import datetime as dt
import json
import os
import base64
import smtplib
import sys
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.environ.get("DCP_URL", "https://daily-commercial-performance.vercel.app")


def data_through():
    try:
        s = open(os.path.join(ROOT, "data.js"), encoding="utf8").read()
        d = json.loads(s[s.index("{"):s.rindex("}") + 1])
        iso = d.get("meta", {}).get("data_through")
        return dt.date.fromisoformat(iso).strftime("%b %d, %Y").replace(" 0", " ")
    except Exception:
        return dt.date.today().strftime("%b %d, %Y").replace(" 0", " ")


def build(summary_html, pdf_path, sender, recipients, subject):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr(("Spectrum Killian Commercial", sender))
    msg["To"] = ", ".join(recipients)
    text = "Daily Commercial Performance. Open the live page: " + LIVE + "\n\n(The summary is in the HTML version of this email; the deck is attached.)"
    body = (
        '<div style="font-family:Montserrat,Segoe UI,Arial,sans-serif;color:#052030;max-width:720px;font-size:14px;line-height:1.5">'
        '<div style="background:#052030;color:#FFFFFF;padding:16px 20px;border-radius:10px 10px 0 0">'
        '<div style="font-size:18px;font-weight:800;letter-spacing:.02em">Daily Commercial Performance</div>'
        '<div style="font-size:12px;color:#C3E8FA;margin-top:2px">Spectrum Killian &middot; data through ' + data_through() + "</div></div>"
        '<div style="border:1px solid #DDE2E9;border-top:4px solid #4ABEEE;padding:18px 20px;border-radius:0 0 10px 10px">'
        + summary_html +
        '<p style="margin:14px 0 0 0"><a href="' + LIVE + '" style="background:#1882C7;color:#FFFFFF;text-decoration:none;font-weight:700;padding:9px 16px;border-radius:8px;display:inline-block">Open the live page</a>'
        '<span style="color:#5A6B79;font-size:12px;margin-left:12px">The full deck is attached as a PDF.</span></p>'
        '<p style="color:#8A98A4;font-size:11px;margin:16px 0 0 0">Sent automatically every morning at 4 AM Pacific. Written by an AI assistant from the dashboard numbers; check the deck before quoting a figure.</p>'
        "</div></div>"
    )
    msg.set_content(text)
    msg.add_alternative(body, subtype="html")
    if pdf_path and os.path.exists(pdf_path):
        with open(pdf_path, "rb") as f:
            msg.add_attachment(f.read(), maintype="application", subtype="pdf", filename=os.path.basename(pdf_path))
    return msg


def send_graph(summary_html, pdf_path, sender, recipients, subject, tenant, client_id, client_secret):
    """Send as the mailbox through Microsoft Graph (client credentials, Mail.Send)."""
    token_req = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data=urllib.parse.urlencode({"client_id": client_id, "client_secret": client_secret, "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"}).encode("utf8"),
        method="POST")
    with urllib.request.urlopen(token_req, timeout=60) as r:
        token = json.loads(r.read().decode("utf8"))["access_token"]
    msg = build(summary_html, pdf_path, sender, recipients, subject)
    html_part = msg.get_body(preferencelist=("html",))
    body = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html_part.get_content() if html_part else summary_html},
            "toRecipients": [{"emailAddress": {"address": a}} for a in recipients],
            "attachments": [],
        },
        "saveToSentItems": True,
    }
    if pdf_path and os.path.exists(pdf_path):
        with open(pdf_path, "rb") as f:
            body["message"]["attachments"].append({"@odata.type": "#microsoft.graph.fileAttachment", "name": os.path.basename(pdf_path),
                                                   "contentType": "application/pdf", "contentBytes": base64.b64encode(f.read()).decode("ascii")})
    req = urllib.request.Request(f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(sender)}/sendMail",
                                 data=json.dumps(body).encode("utf8"), method="POST",
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", default=os.path.join(ROOT, "summary.html"))
    ap.add_argument("--pdf", default=os.path.join(ROOT, "deck.pdf"))
    ap.add_argument("--to", default=None, help="override the recipient list (comma separated)")
    ap.add_argument("--dry-run", action="store_true", help="write the message to email.eml instead of sending")
    args = ap.parse_args()
    sender = os.environ.get("MAIL_FROM", "")
    password = os.environ.get("MAIL_PASSWORD") or os.environ.get("GMAIL_APP_PASSWORD", "")
    host = os.environ.get("MAIL_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("MAIL_SMTP_PORT", "465"))
    recipients = [x.strip() for x in (args.to or os.environ.get("MAIL_TO", "")).split(",") if x.strip()]
    summary_html = open(args.summary, encoding="utf8").read() if os.path.exists(args.summary) else "<p>Summary unavailable this morning.</p>"
    subject = (os.environ.get("MAIL_SUBJECT_PREFIX", "") + "Daily Commercial Performance, " + data_through()).strip()
    tenant, client_id, client_secret = os.environ.get("MS_TENANT_ID", ""), os.environ.get("MS_CLIENT_ID", ""), os.environ.get("MS_CLIENT_SECRET", "")
    graph = bool(tenant and client_id and client_secret)
    if not args.dry_run and (not sender or not recipients or not (graph or password)):
        print("missing MAIL_FROM, MAIL_TO, and either the MS_* app registration or MAIL_PASSWORD", file=sys.stderr)
        sys.exit(1)
    msg = build(summary_html, args.pdf, sender or "sender@example.com", recipients or ["nobody@example.com"], subject)
    if args.dry_run:
        out = os.path.join(ROOT, "email.eml")
        open(out, "wb").write(bytes(msg))
        print("dry run: wrote", out, "size", os.path.getsize(out), "attachment:", os.path.exists(args.pdf))
        return
    if graph:
        status = send_graph(summary_html, args.pdf, sender, recipients, subject, tenant, client_id, client_secret)
        print("sent through Microsoft Graph as", sender, "to", ", ".join(recipients), "status", status, "attachment:", os.path.exists(args.pdf))
        return
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=60) as smtp:
            smtp.login(sender, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(sender, password)
            smtp.send_message(msg)
    print("sent to", ", ".join(recipients), "subject:", subject, "attachment:", os.path.exists(args.pdf))


if __name__ == "__main__":
    main()
