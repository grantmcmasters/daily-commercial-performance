"""Send the morning email: the note in the body, the deck attached, a link to the live page, Grant's signature.

Two ways to send, picked from the environment:
  * Microsoft Graph (preferred for a Microsoft 365 mailbox): set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET for an app
    registration with the Mail.Send application permission, and MAIL_FROM = the mailbox to send from.
  * SMTP (Gmail app password by default; smtp.office365.com on 587 if the tenant still allows SMTP AUTH): MAIL_FROM,
    MAIL_PASSWORD, optional MAIL_SMTP_HOST (smtp.gmail.com) and MAIL_SMTP_PORT (465 = SSL, 587 = STARTTLS).

usage: python pipeline/send_mail.py [--summary summary.html] [--pdf deck.pdf] [--to a@x.com,b@y.com] [--dry-run]
env:   MAIL_TO (comma separated) plus one of the sets above; optional MAIL_SUBJECT_PREFIX, DCP_URL
"""
import argparse
import base64
import datetime as dt
import json
import os
import smtplib
import sys
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.environ.get("DCP_URL", "https://daily-commercial-performance.vercel.app")
SIGNATURE = {
    "name": "Grant McMasters", "title": "Senior Data Analyst", "phone": "980-253-9440", "email": "grant.mcmasters@skdla.com",
    "address": "2850 Red Hill Ave, Suite 200, Santa Ana, CA 92705", "site": "www.SKDLA.com", "site_url": "https://www.skdla.com",
    "logo": os.path.join(ROOT, "logos", "signature-logo.png"),          # inline, cid sig-logo
    "photo": os.path.join(ROOT, "logos", "signature-photo.jpg"),          # optional, inline when the file exists, cid sig-photo
    "image": os.path.join(ROOT, "logos", "signature.jpg"),                # the whole signature as one picture; wins when present, cid sig-full
}


def through_date():
    try:
        s = open(os.path.join(ROOT, "data.js"), encoding="utf8").read()
        d = json.loads(s[s.index("{"):s.rindex("}") + 1])
        return dt.date.fromisoformat(d.get("meta", {}).get("data_through"))
    except Exception:
        return dt.date.today() - dt.timedelta(days=1)


def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def data_through():
    d = through_date()
    return f"{d.strftime('%b')} {ordinal(d.day)}, {d.year}"


def deck_name():
    d = through_date()
    return f"Daily Commercial Performance {d.month}.{d.day}.{d.strftime('%y')}.pdf"


def inline_images():
    """[(cid, path, mime)] for the signature images that exist on disk"""
    out = []
    if os.path.exists(SIGNATURE["image"]):
        return [("sig-full", SIGNATURE["image"], "image/png" if SIGNATURE["image"].lower().endswith(".png") else "image/jpeg")]
    if os.path.exists(SIGNATURE["logo"]):
        out.append(("sig-logo", SIGNATURE["logo"], "image/png"))
    if os.path.exists(SIGNATURE["photo"]):
        out.append(("sig-photo", SIGNATURE["photo"], "image/jpeg"))
    return out


def signature_html(has_photo):
    S, blue, navy = SIGNATURE, "#1882C7", "#052030"
    if os.path.exists(S["image"]):
        return f'<div style="margin:4px 0 18px 0"><img src="cid:sig-full" width="600" alt="{S["name"]}, {S["title"]}, Spectrum Killian" style="display:block;width:600px;max-width:100%;height:auto"></div>'
    contact = (f'<div style="font-size:12.5px;line-height:1.9;color:{blue}">{S["phone"]}<br>'
               f'<a href="mailto:{S["email"]}" style="color:{blue};text-decoration:none">{S["email"]}</a><br>'
               f'{S["address"]}<br><a href="{S["site_url"]}" style="color:{blue};text-decoration:none">{S["site"]}</a></div>')
    logo = '<img src="cid:sig-logo" width="210" alt="Spectrum Killian" style="display:block;width:210px;height:auto;margin:0 0 6px 0">'
    rule = f'<div style="border-top:1px solid {blue};width:230px;margin:2px 0 8px 0"></div>'
    name = f'<div style="font-size:15px;font-weight:700;color:{navy}">{S["name"]}</div><div style="font-size:12px;color:#5A6B79;margin-bottom:6px">{S["title"]}</div>'
    if has_photo:
        left = (f'<td style="vertical-align:top;padding:0 18px 0 0;border-right:1px solid #DDE2E9;text-align:center">'
                f'<img src="cid:sig-photo" width="130" alt="{S["name"]}" style="display:block;width:130px;height:auto;margin:0 auto 6px auto">{name}</td>')
        right = f'<td style="vertical-align:top;padding:0 0 0 18px">{logo}{rule}{contact}</td>'
    else:
        left = ""
        right = f'<td style="vertical-align:top;padding:0">{name}{logo}{rule}{contact}</td>'
    return f'<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 18px 0"><tr>{left}{right}</tr></table>'


def body_html(summary_html, has_photo):
    return (
        '<div style="font-family:Calibri,Segoe UI,Arial,sans-serif;color:#1F2933;font-size:15px;line-height:1.55;max-width:760px">'
        + summary_html +
        '<p style="margin:0 0 12px 0">The full deck is attached, and the live page is always at <a href="' + LIVE + '" style="color:#1882C7">' + LIVE.replace("https://", "") + "</a>.</p>"
        '<p style="margin:0 0 10px 0">Best,</p>'
        + signature_html(has_photo) +
        '<p style="color:#8A98A4;font-size:11px;margin:0">Sent automatically every morning at 4 AM Pacific from the Daily Commercial Performance dashboard. Drafted by an AI assistant from the dashboard numbers; check the deck before quoting a figure.</p>'
        "</div>"
    )


def build(summary_html, pdf_path, sender, recipients, subject):
    images = inline_images()
    has_photo = any(cid == "sig-photo" for cid, _, _ in images)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((SIGNATURE["name"], sender))
    msg["To"] = ", ".join(recipients)
    text = "Daily Commercial Performance, data through " + data_through() + ". Open the live page: " + LIVE + "\n\n(The note is in the HTML version of this email; the deck is attached.)"
    msg.set_content(text)
    msg.add_alternative(body_html(summary_html, has_photo), subtype="html")
    html_part = msg.get_payload()[-1]
    for cid, path, mime in images:
        with open(path, "rb") as f:
            html_part.add_related(f.read(), maintype=mime.split("/")[0], subtype=mime.split("/")[1], cid=f"<{cid}>", disposition="inline")
    if pdf_path and os.path.exists(pdf_path):
        with open(pdf_path, "rb") as f:
            msg.add_attachment(f.read(), maintype="application", subtype="pdf", filename=deck_name())
    return msg


def send_graph(summary_html, pdf_path, sender, recipients, subject, tenant, client_id, client_secret):
    """Send as the mailbox through Microsoft Graph (client credentials, Mail.Send)."""
    token_req = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data=urllib.parse.urlencode({"client_id": client_id, "client_secret": client_secret, "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"}).encode("utf8"),
        method="POST")
    with urllib.request.urlopen(token_req, timeout=60) as r:
        token = json.loads(r.read().decode("utf8"))["access_token"]
    images = inline_images()
    has_photo = any(cid == "sig-photo" for cid, _, _ in images)
    attachments = []
    for cid, path, mime in images:
        with open(path, "rb") as f:
            attachments.append({"@odata.type": "#microsoft.graph.fileAttachment", "name": os.path.basename(path), "contentType": mime,
                                "isInline": True, "contentId": cid, "contentBytes": base64.b64encode(f.read()).decode("ascii")})
    if pdf_path and os.path.exists(pdf_path):
        with open(pdf_path, "rb") as f:
            attachments.append({"@odata.type": "#microsoft.graph.fileAttachment", "name": deck_name(), "contentType": "application/pdf",
                                "contentBytes": base64.b64encode(f.read()).decode("ascii")})
    body = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html(summary_html, has_photo)},
            "toRecipients": [{"emailAddress": {"address": a}} for a in recipients],
            "attachments": attachments,
        },
        "saveToSentItems": True,
    }
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
    summary_html = open(args.summary, encoding="utf8").read() if os.path.exists(args.summary) else "<p>The morning note is unavailable today; the deck is attached.</p>"
    subject = (os.environ.get("MAIL_SUBJECT_PREFIX", "") + "Daily Commercial Performance - " + data_through()).strip()
    tenant, client_id, client_secret = os.environ.get("MS_TENANT_ID", ""), os.environ.get("MS_CLIENT_ID", ""), os.environ.get("MS_CLIENT_SECRET", "")
    graph = bool(tenant and client_id and client_secret)
    if not args.dry_run and (not sender or not recipients or not (graph or password)):
        print("missing MAIL_FROM, MAIL_TO, and either the MS_* app registration or MAIL_PASSWORD", file=sys.stderr)
        sys.exit(1)
    msg = build(summary_html, args.pdf, sender or "sender@example.com", recipients or ["nobody@example.com"], subject)
    if args.dry_run:
        out = os.path.join(ROOT, "email.eml")
        open(out, "wb").write(bytes(msg))
        print("dry run: wrote", out, "size", os.path.getsize(out), "subject:", subject, "attachment:", deck_name() if os.path.exists(args.pdf) else "none",
              "inline images:", [c for c, _, _ in inline_images()])
        return
    if graph:
        status = send_graph(summary_html, args.pdf, sender, recipients, subject, tenant, client_id, client_secret)
        print("sent through Microsoft Graph as", sender, "to", ", ".join(recipients), "status", status, "attachment:", os.path.exists(args.pdf))
        return
    for attempt in range(4):
        try:
            if port == 465:
                with smtplib.SMTP_SSL(host, port, timeout=90) as smtp:
                    smtp.login(sender, password)
                    smtp.send_message(msg)
            else:
                with smtplib.SMTP(host, port, timeout=90) as smtp:
                    smtp.ehlo()
                    smtp.starttls()
                    smtp.ehlo()
                    smtp.login(sender, password)
                    smtp.send_message(msg)
            break
        except smtplib.SMTPAuthenticationError:
            raise
        except (smtplib.SMTPException, OSError) as e:
            if attempt == 3:
                raise
            print(f"send attempt {attempt + 1} failed: {e}; retrying in 60s", file=sys.stderr, flush=True)
            time.sleep(60)
    print("sent to", ", ".join(recipients), "subject:", subject, "attachment:", os.path.exists(args.pdf))


if __name__ == "__main__":
    main()
