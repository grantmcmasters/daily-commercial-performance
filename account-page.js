/* Daily Commercial Performance: one practice's page.
   Our own history (details.js) plus the Account Health model for that practice (health/<section>-<key>.js):
   where it stands, the trend, the AI summary, the plays and the predictions. */
(function () {
  "use strict";
  var D = window.DCP_DETAILS || { meta: {}, sections: {} };
  var byId = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var SEC = q.get("sec") || "ae", KEY = q.get("key") || "", PID = q.get("pid") || "", METRIC = q.get("metric") || "";
  var months = D.meta.months || [];
  var STATE = { "0": { label: "Inactive", color: "#EF4444", bg: "rgba(239,68,68,.14)", ink: "#B0362F" }, "1": { label: "Dabbler", color: "#4ABEEE", bg: "rgba(74,190,238,.22)", ink: "#0F6BA8" },
                "2": { label: "Core Active", color: "#1882C7", bg: "rgba(24,130,199,.18)", ink: "#0F6BA8" }, "3": { label: "Super Active", color: "#052030", bg: "rgba(5,32,48,.16)", ink: "#052030" } };
  var LINES = { CB: "Crown and Bridge", REM: "Removables", IMP: "Implants", FA: "Full Arch", HE: "High Esthetics", OTH: "Other" };
  var LINE_COLOR = { CB: "#1882C7", IMP: "#052030", REM: "#8A93A3", FA: "#B3A369", HE: "#4ABEEE", OTH: "#C3E8FA" };
  var BAR = { CB: 60, REM: 30, IMP: 12, FA: 12, HE: 12 };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtN(n) { return (n == null || isNaN(n)) ? "--" : Math.round(Number(n)).toLocaleString("en-US"); }
  function fmt1(n) { return (n == null || isNaN(n)) ? "--" : (Math.round(Number(n) * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function fmtMoney(v) { if (v == null || isNaN(v)) return "--"; var a = Math.abs(v), s = v < 0 ? "-" : ""; return s + "$" + Math.round(a).toLocaleString("en-US"); }
  function signPct(r) { if (r == null || isNaN(r)) return "--"; var p = Math.round(r * 100); return (p > 0 ? "+" : "") + p + "%"; }
  function signMoney(v) { if (v == null || isNaN(v)) return "--"; return (v > 0 ? "+" : "") + fmtMoney(v); }
  function longDate(iso) { if (!iso) return ""; try { var p = iso.split("-"); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(+p[0], +p[1] - 1, +p[2])); } catch (e) { return iso; } }
  function monthLabel(ym) { try { var p = ym.split("-"); return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(new Date(+p[0], +p[1] - 1, 1)).replace(" ", " '"); } catch (e) { return ym; } }
  function weekLabel(iso) { try { var p = iso.split("-"); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(+p[0], +p[1] - 1, +p[2])); } catch (e) { return iso; } }

  var S = (D.sections[SEC] || {})[KEY];
  var row = S ? S.rows.filter(function (r) { return r.pid === PID; })[0] : null;
  var H = (window.DCP_HEALTH && window.DCP_HEALTH.practices && window.DCP_HEALTH.practices[PID]) || null;
  var HM = (window.DCP_HEALTH && window.DCP_HEALTH.meta) || D.meta.health || {};
  var backHref = "details.html?sec=" + SEC + "&key=" + encodeURIComponent(KEY) + (METRIC ? "&metric=" + METRIC : "");
  byId("asof").textContent = "Data through " + longDate(D.meta.data_through || D.meta.run_date);
  byId("back-list").href = backHref;
  if (S) byId("back-list").textContent = "← Back to the " + S.title + " list";
  var pd = byId("pill-details"); if (pd && S) pd.href = backHref;
  if (!row) {
    var lastList = "details.html";
    try { lastList = "details.html" + (localStorage.getItem("dcp.lastDetails") || ""); } catch (e) { /* ignore */ }
    byId("acct").innerHTML = '<div class="card"><div class="sub-title">Pick a practice to drill into</div><p class="dt-note" style="font-size:13.5px;margin-top:6px">The Account Drilldown shows one practice at a time. Open the <a href="' + esc(lastList) + '" style="color:#0F6BA8;font-weight:800">Details</a> list, then click any practice.</p></div>';
    return;
  }
  try { localStorage.setItem("dcp.lastAccount", location.search); localStorage.setItem("dcp.lastDetails", "?sec=" + SEC + "&key=" + encodeURIComponent(KEY) + (METRIC ? "&metric=" + METRIC : "")); } catch (e) { /* ignore */ }
  document.title = row.name + " Account Page";

  /* ---------- pieces ---------- */
  function stateChip(code, big) { var s = STATE[code] || STATE["0"]; return '<span class="stchip' + (big ? " big" : "") + '" style="background:' + s.bg + ';color:' + s.ink + '">' + s.label + "</span>"; }
  function movement() {
    return '<div class="mvrow">' + (row.hist || "").split("").map(function (c, i) { var s = STATE[c] || STATE["0"]; return '<div class="mvcell"><i style="background:' + s.color + '"></i><span>' + esc(months[i] || "") + "</span></div>"; }).join("") + "</div>";
  }
  function usualPace() {
    if (H && H.monthly && H.monthly.length > 3) { var full = H.monthly.slice(-4, -1); return full.reduce(function (a, m) { return a + (m.c || 0); }, 0) / full.length; }
    var cm = (row.cm || []).slice(0, -1).slice(-3); return cm.length ? cm.reduce(function (a, b) { return a + b; }, 0) / cm.length : null;
  }
  function tile(v, l, cls) { return '<div class="stat' + (cls ? " " + cls : "") + '"><div class="v">' + v + '</div><div class="l">' + esc(l) + "</div></div>"; }

  var hasPred = !!(H && H.active_book && typeof H.act_ratio30 === "number");
  var ownerLine = (SEC === "am" ? "Account manager: " + esc(S.title) : SEC === "ae" ? "Account executive: " + esc(S.owner) : "Program: " + esc(S.title)) +
    (H && H.am && H.am !== "None" && SEC !== "am" ? " &middot; Account manager: " + esc(H.am) : "") + (H && H.sae && SEC !== "ae" ? " &middot; Account executive: " + esc(H.sae) : "");

  /* alert */
  var alert = "";
  if (H && H.triage && (H.triage.cls === "SHIFT" || H.triage.cls === "EARLY")) {
    var isS = H.triage.cls === "SHIFT";
    alert = '<div class="card alert ' + (isS ? "shift" : "early") + '"><div class="ckick">' + (isS ? "Churn alert: call now" : "Early warning: get ahead of it") + "</div>" +
      '<p class="serif">' + esc(H.triage.t) + "." + (typeof H.triage.recov === "number" ? " Only " + H.triage.recov + " of 100 shifts like this come back without a call." : "") + "</p>" +
      (H.triage.detail ? '<p class="dt-note">' + esc(H.triage.detail) + "</p>" : "") + "</div>";
  }

  /* hero */
  var chips = '<span class="chip chip-b">' + esc(H && H.segment ? H.segment : (S.title)) + "</span> " + stateChip(row.st, true) +
    (hasPred && H.bucket3 ? ' <span class="chip chip-soft">' + esc(String(H.bucket3).charAt(0) + String(H.bucket3).slice(1).toLowerCase()) + "</span>" : "") +
    (hasPred ? ' <span class="chip chip-action">Predicted next 30 days: ' + fmtN(H.pred_cases30) + " cases (" + signPct(H.act_ratio30 - 1) + ")</span>" : "");
  var stats = tile(fmtN(H ? H.cases_30 : row.c90), H ? "Cases last 30 days" : "Cases last 90 days") +
    tile(fmt1(usualPace()), "Usual monthly pace") +
    (hasPred ? tile(fmtN(H.pred_cases30), "Predicted next 30 days") + tile(signPct(H.act_ratio30 - 1), "Expected change", (H.act_ratio30 - 1) >= 0 ? "up" : "dn") : tile(fmtN(row.ytd), "Cases YTD") + tile(row.last ? esc(longDate(row.last)) : "--", "Last case")) +
    (H ? tile(fmtMoney(H.rev_month), "Monthly revenue") : tile(fmtN(row.p90), "Prior 90 days")) +
    (hasPred ? tile(signMoney(H.impact_month), "Predicted monthly impact", H.impact_month >= 0 ? "up" : "dn") : tile(row.first ? esc(longDate(row.first)) : "--", "First case"));
  var predCats = hasPred && H.pred_cats && H.pred_cats.length ? '<p class="dt-note">Predicted category split: ' + H.pred_cats.map(function (c) { return "about " + fmt1(c[1]) + " " + (LINES[c[0]] || c[0]); }).join(", ") + " (allocated by their recent mix).</p>" : "";
  var hero = '<div class="card"><div class="ahead"><h3>' + esc(row.name) + '</h3><div class="chips">' + chips + '</div></div>' +
    '<div class="owner">' + ownerLine + ' &middot; Practice ' + esc(row.pid) + (row.acc && row.acc.length ? " &middot; Accounts " + esc(row.acc.join(", ")) : "") + "</div>" +
    '<div class="stats">' + stats + "</div>" + predCats + "</div>";

  /* where it stands: bars per business unit against the thresholds, plus the month by month movement */
  function lineBars() {
    var ls = (H && H.line_states) || {};
    var keys = Object.keys(BAR).filter(function (k) { return ls[k] || (H && H.super_active_lines && H.super_active_lines.indexOf(k) >= 0); });
    if (!keys.length) return '<p class="dt-note">No business unit detail for this practice in the Account Health model' + (H ? "" : " (it is outside the modeled book)") + ".</p>";
    return keys.map(function (k) {
      var L = ls[k] || {}, full = BAR[k], half = Math.ceil(full / 2), q1 = L.q1 || 0, q2 = L.q2 || 0, w = Math.min(100, 100 * q1 / (full * 1.15)), col = LINE_COLOR[k];
      var lvl = q1 >= full ? "Super Active" : q1 >= half ? "Core Active" : q1 > 0 ? "Dabbler" : "Inactive";
      return '<div class="lb"><div class="lbn"><i style="background:' + col + '"></i>' + esc(LINES[k]) + '</div>' +
        '<div class="lbt"><span class="lbfill" style="width:' + w.toFixed(1) + '%;background:' + col + '"></span>' +
        '<span class="lbmark" style="left:' + (100 * half / (full * 1.15)).toFixed(1) + '%"><b>Core ' + half + '</b></span><span class="lbmark" style="left:' + (100 / 1.15).toFixed(1) + '%"><b>Super ' + full + '</b></span></div>' +
        '<div class="lbv"><b>' + fmtN(q1) + '</b> last 90 days <span class="dt-note">(' + fmtN(q2) + ' the 90 before)</span> &middot; ' + esc(lvl) + "</div></div>";
    }).join("");
  }
  var stands = '<div class="card"><div class="spark-h">Where this practice stands</div>' +
    '<div class="stands-grid"><div><div class="m3-varh">Cases received in the last 90 days, by business unit, against the bar</div>' + lineBars() + "</div>" +
    '<div><div class="m3-varh">State at the end of each month, ' + esc(String(D.meta.run_date || "").slice(0, 4)) + "</div>" + movement() +
    '<p class="dt-note" style="margin-top:8px">Today: ' + stateChip(row.st) + ' &middot; 30 days ago: ' + stateChip(row.l30) + ' &middot; start of ' + esc(S.quarter || D.meta.quarter || "the quarter") + ": " + stateChip(row.q0) + "</p>" +
    '<p class="dt-note">Half the bar in any one business unit in the last 90 days = Core Active. The full bar in the last 90 days = Super Active. Any case below the bar = Dabbler. Nothing in 90 days = Inactive.</p></div></div></div>';

  /* AI summary and plays */
  var brief = "";
  if (H && H.brief && H.brief.s) {
    brief = '<div class="card"><div class="spark-h">Account health summary</div><p class="serif">' + esc(H.brief.s) + "</p>" +
      ((H.brief.talk || []).length ? '<div class="m3-varh">When you call</div><ul class="whylist">' + H.brief.talk.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
      ((H.plays || []).length ? '<div class="m3-varh">The plays</div><ul class="whylist">' + H.plays.map(function (p) { return '<li><span class="chip chip-action">' + esc(p.p) + "</span> " + esc(p.d) + "</li>"; }).join("") + "</ul>" : "") +
      ((H.call_prep || []).length ? '<div class="m3-varh">Before you call</div><ul class="whylist">' + H.call_prep.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="dt-note">Written by the Account Health model from this practice\'s own numbers; model run ' + esc(longDate(HM.run_date)) + ".</p></div>";
  } else if (H && H.driver_short) {
    brief = '<div class="card"><div class="spark-h">Account health summary</div><p class="serif">' + esc(H.driver_short) + "</p></div>";
  }

  /* why the model thinks so */
  var why = "";
  if (hasPred && ((H.why && H.why.length) || (H.reasons && H.reasons.length))) {
    var items = (H.why || []).map(function (w) { return { t: w.t, pts: w.pts }; }).concat((H.reasons || []).map(function (r) { return { t: r.label, pts: r.pts }; }));
    why = '<div class="card"><div class="spark-h">Why the model thinks so</div><ul class="whylist">' + items.map(function (w) { return "<li>" + esc(w.t) + (typeof w.pts === "number" ? ' <span class="pts ' + (w.pts >= 0 ? "up" : "dn") + '">' + (w.pts > 0 ? "+" : "") + w.pts + "</span>" : "") + "</li>"; }).join("") +
      "</ul>" + (typeof H.p_churn === "number" ? '<p class="dt-note">Churn probability ' + Math.round(H.p_churn * 100) + "%" + (H.tier ? ", " + esc(H.tier) + " risk tier" : "") + ".</p>" : "") + "</div>";
  }

  /* volume over time, the fallback: our own monthly bars when live history cannot be fetched */
  var mode = { unit: "c", by: "month" };
  function volChart() {
    var series = mode.by === "month" ? (H && H.monthly) || [] : (H && H.weekly) || [];
    if (!series.length && mode.by === "month") series = (row.cm || []).map(function (v, i) { return { m: months[i], c: v, r: null, cats: null }; });
    if (!series.length) return '<p class="dt-note">No history to chart.</p>';
    var W = 960, H_ = 300, padL = 46, padR = 12, padT = 28, padB = 30, n = series.length, iw = W - padL - padR, ih = H_ - padT - padB, slot = iw / n, bw = Math.min(56, slot * 0.62);
    var val = function (s) { return mode.unit === "r" ? (s.r || 0) : (mode.by === "month" ? (s.c || 0) : (s.t || 0)); };
    var max = Math.max.apply(null, series.map(val).concat([1]));
    var ticks = niceTicks(max), ymax = ticks[ticks.length - 1] || 1, y = function (v) { return padT + ih - (v / ymax) * ih; };
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H_ + '" class="vol">'];
    ticks.forEach(function (t) { out.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="#DDE2E9"/><text x="' + (padL - 8) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="#5A6B79">' + (mode.unit === "r" ? "$" + fmtN(t) : fmtN(t)) + "</text>"); });
    series.forEach(function (s, i) {
      var cx = padL + slot * i + slot / 2, x = cx - bw / 2, total = val(s), base = 0, cats = s.cats || null;
      if (cats && mode.unit !== "r" || cats && mode.by === "month") {
        Object.keys(cats).forEach(function (k) {
          var v = mode.by === "month" ? (mode.unit === "r" ? (cats[k].r || 0) : (cats[k].c || 0)) : (cats[k] || 0);
          if (v <= 0) return;
          out.push('<rect x="' + x.toFixed(1) + '" y="' + y(base + v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(base) - y(base + v)).toFixed(1) + '" fill="' + (LINE_COLOR[k] || "#C3E8FA") + '"><title>' + esc(LINES[k] || k) + ": " + (mode.unit === "r" ? fmtMoney(v) : fmtN(v)) + "</title></rect>");
          base += v;
        });
      } else if (total > 0) {
        out.push('<rect x="' + x.toFixed(1) + '" y="' + y(total).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(0) - y(total)).toFixed(1) + '" fill="#1882C7"/>');
      }
      if (total > 0) out.push('<text x="' + cx.toFixed(1) + '" y="' + (y(total) - 6).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="800" fill="#052030">' + (mode.unit === "r" ? "$" + fmtN(total / 1000) + "k" : fmtN(total)) + "</text>");
      out.push('<text x="' + cx.toFixed(1) + '" y="' + (H_ - 9) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#5A6B79">' + esc(mode.by === "month" ? (s.m && s.m.indexOf("-") > 0 ? monthLabel(s.m) : s.m) : weekLabel(s.w)) + "</text>");
    });
    out.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#B0B7C3"/>');
    return out.join("") + "</svg>";
  }
  function niceTicks(max) {
    if (max <= 0) return [0, 1];
    var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    if (step < 1) step = 1; else if (step === 2.5) step = 5;
    var out = [];
    for (var v = 0; v <= max + step - 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }
  var legend = Object.keys(LINE_COLOR).filter(function (k) { return k !== "OTH"; }).map(function (k) { return '<span><i style="background:' + LINE_COLOR[k] + '"></i>' + esc(LINES[k]) + "</span>"; }).join("");
  function fallbackHTML() {
    return '<div class="seg-row" id="vol-controls"><div class="seg" data-dim="unit"><button type="button" data-v="c" class="on">Cases</button><button type="button" data-v="r"' + (H ? "" : " disabled") + '>Revenue</button></div>' +
      '<div class="seg" data-dim="by"><button type="button" data-v="month" class="on">By month</button><button type="button" data-v="week"' + (H && H.weekly ? "" : " disabled") + '>By week</button></div>' +
      '<div class="legend">' + legend + "</div></div>" +
      '<div id="vol-chart">' + volChart() + "</div>" +
      '<p class="dt-note">' + (H ? "Received date; the last month is to date. Revenue is invoiced dollars by category from the Account Health model." : "Received date, this year, from the Daily Commercial Performance engine; the last month is to date.") + "</p>";
  }
  function wireFallback() {
    var ctl = byId("vol-controls");
    if (!ctl) return;
    ctl.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".seg button") : null;
      if (!b || b.disabled) return;
      [].forEach.call(b.parentNode.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      mode[b.parentNode.getAttribute("data-dim")] = b.getAttribute("data-v");
      byId("vol-chart").innerHTML = volChart();
    });
  }

  /* ---------- volume over time: the Account Health chart, live from the same history ----------
     The history comes from the two public read-only functions the Account Health page calls (one row per day,
     business unit and basis; one row per case). By month is the default; 90 day buckets are the window behind
     Core Active and Super Active, and when buckets are chosen the left date is set so the last bucket ends today. */
  var SUPA_URL = "https://asdunkqodixbhbohxtuq.supabase.co", SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZHVua3FvZGl4Ymhib2h4dHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDUwNTcsImV4cCI6MjA5MDgyMTA1N30.lStrSSEpwFFk5GuXl2qzh2tr6bLZFY4_x9u6q4FcVeo";
  var LINE_ORDER = ["CB", "IMP", "REM", "FA", "HE"], MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var dd = { basis: "recv", metric: "cases", gran: "month", an: "", roll: 0, from: "", to: "" };
  var DRILL = null, CASES = null, ddTimer = null, CHARTS = {}, chartSeq = 0, tipEl = null, ddMin = "";
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function dUTC(s) { var p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function dStr(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
  function dAdd(s, n) { return dStr(dUTC(s) + n * 86400000); }
  function dDiff(a, b) { return Math.round((dUTC(b) - dUTC(a)) / 86400000); }
  function dayLabel(s) { var p = s.split("-"); return MONTHS3[+p[1] - 1] + " " + (+p[2]); }
  function dayLabelY(s) { var p = s.split("-"); return MONTHS3[+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; }
  function ddKey(s, gran) {
    if (gran === "day") return s;
    if (gran === "week") { var ms = dUTC(s), wd = (new Date(ms).getUTCDay() + 6) % 7; return dStr(ms - wd * 86400000); }
    if (gran === "quarter") { var p = s.split("-"); return p[0] + " Q" + (Math.floor((+p[1] - 1) / 3) + 1); }
    return s.slice(0, 7);
  }
  function ddKeyRange(a, b, gran) { var out = [], seen = {}; for (var ms = dUTC(a), end = dUTC(b); ms <= end; ms += 86400000) { var k = ddKey(dStr(ms), gran); if (!seen[k]) { seen[k] = 1; out.push(k); } } return out; }
  function ddLabel(k, gran) { if (gran === "month") { var p = k.split("-"); return MONTHS3[+p[1] - 1] + " " + p[0]; } if (gran === "quarter") return k; return dayLabel(k); }
  function money(n) { n = n || 0; if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1e3) return "$" + Math.round(n / 1e3) + "k"; return "$" + Math.round(n); }
  function rpcFetch(fn) {
    var rows = [];
    function page(off) {
      return fetch(SUPA_URL + "/rest/v1/rpc/" + fn + "?p_pid=" + encodeURIComponent(PID) + "&limit=1000&offset=" + off, { headers: { apikey: SUPA_ANON, Authorization: "Bearer " + SUPA_ANON } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (b) { if (!Array.isArray(b)) throw new Error("bad rows"); rows = rows.concat(b); if (b.length === 1000) return page(off + 1000); return rows; });
    }
    return page(0);
  }
  function ddBasisMin(rows) { var m = null; rows.forEach(function (r) { if (r.basis === dd.basis && r.d && (!m || r.d < m)) m = r.d; }); return m || todayStr(); }
  function anchorFrom(minD, to) {
    /* buckets are counted from the left date, so pick the left date that makes the last bucket end on the right date */
    if (!dd.roll) return minD;
    var k = Math.max(1, Math.floor((dDiff(minD, to) + 1) / dd.roll)), from = dAdd(to, -(dd.roll * k - 1));
    return from < minD ? minD : from;
  }
  function metricOf(r) { return dd.metric === "cases" ? (+r.cases || 0) : dd.metric === "units" ? (+r.q_units || 0) : (+r.revenue || 0); }
  function fmtV(v) { return dd.metric === "revenue" ? money(v) : fmtN(v); }
  function buildSeries(rows) {
    var f = rows.filter(function (r) { return r.basis === dd.basis && (!dd.an || r.an === dd.an) && r.d && r.d >= dd.from && r.d <= dd.to; });
    if (!f.length) return null;
    var cats = LINE_ORDER.filter(function (k) { return f.some(function (r) { return r.line === k; }); });
    if (!cats.length) cats = ["CB"];
    var series = cats.map(function (c) { return { k: c, name: LINES[c], color: LINE_COLOR[c], vals: [] }; }), labels = [], spans = [], ci = {};
    cats.forEach(function (c, i) { ci[c] = i; });
    if (dd.roll > 0) {
      var days = dDiff(dd.from, dd.to) + 1, nb = Math.max(1, Math.ceil(days / dd.roll));
      for (var b = 0; b < nb; b++) {
        var a = dAdd(dd.from, b * dd.roll), e = dAdd(dd.from, Math.min(days, (b + 1) * dd.roll) - 1);
        labels.push(dayLabel(a)); spans.push([a, e]); series.forEach(function (s) { s.vals.push(0); });
      }
      f.forEach(function (r) { if (ci[r.line] === undefined) return; series[ci[r.line]].vals[Math.floor(dDiff(dd.from, r.d) / dd.roll)] += metricOf(r); });
    } else {
      var keys = ddKeyRange(dd.from, dd.to, dd.gran), ki = {};
      keys.forEach(function (k, i) { ki[k] = i; });
      series.forEach(function (s) { s.vals = keys.map(function () { return 0; }); });
      f.forEach(function (r) { if (ci[r.line] === undefined) return; var ix = ki[ddKey(r.d, dd.gran)]; if (ix !== undefined) series[ci[r.line]].vals[ix] += metricOf(r); });
      labels = keys.map(function (k) { return ddLabel(k, dd.gran); });
    }
    series.forEach(function (s) { s.vals = s.vals.map(function (v) { return Math.round(v * 10) / 10; }); });
    var totals = labels.map(function (_, i) { return Math.round(series.reduce(function (t, s) { return t + s.vals[i]; }, 0) * 10) / 10; });
    return { series: series, labels: labels, totals: totals, spans: spans };
  }
  function guidesFor(series, dataMax) {
    /* the Core and Super bars of the business units on the chart, shown when they are within reach of the plotted values */
    if (dd.metric !== "cases" || dd.roll !== 90) return [];
    var byV = {};
    series.forEach(function (s) {
      var full = BAR[s.k]; if (!full) return;
      [[Math.ceil(full / 2), "Core"], [full, "Super"]].forEach(function (t) { var key = t[0] + ":" + t[1]; (byV[key] = byV[key] || { v: t[0], lvl: t[1], ks: [], color: s.color }).ks.push(s.k); });
    });
    var all = Object.keys(byV).map(function (key) { var g = byV[key]; return { v: g.v, color: g.ks.length > 1 ? "#5A6B79" : g.color, label: g.ks.join("/") + " " + g.lvl + " " + g.v }; }).sort(function (a, b) { return a.v - b.v; });
    var above = all.filter(function (g) { return g.v > dataMax; })[0], cap = Math.max(dataMax * 1.6, above && above.v <= dataMax * 4 ? above.v : 0);
    return all.filter(function (g) { return g.v <= cap; });
  }
  function catChart(o) {
    var id = "ch" + (++chartSeq), w = 960, h = o.h || 300, pL = 10, pR = 12, pT = 22, pB = 26, n = o.labels.length, iw = w - pL - pR, ih = h - pT - pB, max = 1;
    CHARTS[id] = o;
    o.series.forEach(function (s) { s.vals.forEach(function (v) { if (v > max) max = v; }); });
    (o.guides || []).forEach(function (g) { if (g.v > max) max = g.v; });
    function xs(i) { return n > 1 ? pL + i * iw / (n - 1) : pL + iw / 2; }
    function ys(v) { return pT + ih - (v / max) * ih; }
    o.geo = { w: w, pL: pL, iw: iw, n: n };
    var f = "font-family:Montserrat,Arial,sans-serif;font-size:11px;fill:#5A6B79";
    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Volume over time by business unit">' +
      '<line x1="' + pL + '" y1="' + pT + '" x2="' + (w - pR) + '" y2="' + pT + '" stroke="#DDE2E9" stroke-dasharray="3 4"/>' +
      '<line x1="' + pL + '" y1="' + (pT + ih) + '" x2="' + (w - pR) + '" y2="' + (pT + ih) + '" stroke="#DDE2E9"/>' +
      '<line class="guide" x1="0" y1="' + pT + '" x2="0" y2="' + (pT + ih) + '" stroke="#1882C7" stroke-dasharray="2 3" opacity="0"/>';
    (o.guides || []).forEach(function (g) {
      var gy = ys(g.v).toFixed(1);
      svg += '<line x1="' + pL + '" y1="' + gy + '" x2="' + (w - pR) + '" y2="' + gy + '" stroke="' + g.color + '" stroke-width="1.2" stroke-dasharray="6 5" opacity=".75"/>' +
        '<text x="' + (w - pR) + '" y="' + (ys(g.v) - 4).toFixed(1) + '" text-anchor="end" style="' + f + ';font-size:10px;font-weight:800;fill:' + g.color + '">' + esc(g.label) + "</text>";
    });
    o.series.forEach(function (s) {
      var d = "";
      for (var i = 0; i < n; i++) d += (i ? "L" : "M") + xs(i).toFixed(1) + " " + ys(s.vals[i]).toFixed(1) + " ";
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
      var imax = 0;
      for (var j2 = 1; j2 < n; j2++) if (s.vals[j2] > s.vals[imax]) imax = j2;
      var marks = {}; marks[0] = 1; marks[n - 1] = 1; marks[imax] = 1;
      Object.keys(marks).forEach(function (ix) {
        var i2 = parseInt(ix, 10), x2 = xs(i2), y2 = ys(s.vals[i2]), anchor = i2 === 0 ? "start" : (i2 === n - 1 ? "end" : "middle");
        svg += '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="3.2" fill="' + s.color + '"/>' +
          '<text x="' + x2.toFixed(1) + '" y="' + Math.max(10, y2 - 7).toFixed(1) + '" text-anchor="' + anchor + '" style="' + f + ';font-size:12.5px;font-weight:800;fill:' + s.color + '">' + esc(o.fmt(s.vals[i2])) + "</text>";
      });
    });
    svg += '<text x="' + pL + '" y="' + (h - 5) + '" style="' + f + ';font-weight:700">' + esc(o.labels[0]) + "</text>" +
      '<text x="' + (w - pR) + '" y="' + (h - 5) + '" text-anchor="end" style="' + f + ';font-weight:700">' + esc(o.labels[n - 1]) + "</text></svg>";
    return '<div class="chartwrap" data-chart="' + id + '">' + svg + "</div>";
  }
  function getTip() { if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; document.body.appendChild(tipEl); } return tipEl; }
  function wireCharts(scope) {
    [].forEach.call(scope.querySelectorAll("[data-chart]"), function (el) {
      if (el._wired) return;
      el._wired = 1;
      var o = CHARTS[el.getAttribute("data-chart")], guide = el.querySelector(".guide");
      if (!o) return;
      el.addEventListener("mousemove", function (e) {
        var r = el.getBoundingClientRect(), g = o.geo;
        if (!r.width) return;
        var i = Math.round(((e.clientX - r.left) * (g.w / r.width) - g.pL) / (g.iw / Math.max(1, g.n - 1)));
        i = Math.max(0, Math.min(g.n - 1, i));
        var gx = g.n > 1 ? g.pL + i * g.iw / (g.n - 1) : g.pL + g.iw / 2;
        if (guide) { guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.setAttribute("opacity", "0.7"); }
        var t = getTip(), html = '<div class="th">' + esc(o.spans && o.spans[i] ? dayLabelY(o.spans[i][0]) + " to " + dayLabelY(o.spans[i][1]) : o.labels[i]) + "</div>";
        o.series.forEach(function (s) { html += '<div class="tr"><span><span class="cd" style="background:' + s.color + '"></span>' + esc(s.name) + '</span><span class="v">' + esc(o.fmt(s.vals[i])) + "</span></div>"; });
        if (o.totals) html += '<div class="tr tt"><span>Total</span><span class="v">' + esc(o.fmt(o.totals[i])) + "</span></div>";
        t.innerHTML = html; t.style.display = "block";
        var tw = t.offsetWidth, th = t.offsetHeight, x = e.clientX + 14, y = e.clientY + 14;
        if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 14;
        if (y + th > window.innerHeight - 8) y = e.clientY - th - 14;
        t.style.left = x + "px"; t.style.top = y + "px";
      });
      el.addEventListener("mouseleave", function () { if (guide) guide.setAttribute("opacity", "0"); if (tipEl) tipEl.style.display = "none"; });
    });
  }
  function catLegend(series) { return '<div class="legend vol-legend">' + series.map(function (s) { return '<span><span class="ldot" style="background:' + s.color + '"></span>' + esc(s.name) + "</span>"; }).join("") + "</div>"; }
  function stanceHTML(rows, built) {
    /* the last bucket against the bar, one card per business unit this practice has ever sent */
    if (dd.metric !== "cases" || dd.roll !== 90 || !built || !built.spans.length) return "";
    var last = built.spans[built.spans.length - 1], days = dDiff(last[0], last[1]) + 1;
    var ks = LINE_ORDER.filter(function (k) { return BAR[k] && rows.some(function (r) { return r.basis === dd.basis && r.line === k && (!dd.an || r.an === dd.an); }); });
    if (!ks.length) return "";
    var items = ks.map(function (k) {
      var s = built.series.filter(function (x) { return x.k === k; })[0], v = s ? s.vals[s.vals.length - 1] : 0, full = BAR[k], half = Math.ceil(full / 2);
      var code = v >= full ? "3" : v >= half ? "2" : v > 0 ? "1" : "0";
      return '<div class="stance-item"><div class="sn"><i style="background:' + LINE_COLOR[k] + '"></i>' + esc(LINES[k]) + '</div><div class="sv"><b>' + fmtN(v) + "</b> " + (v === 1 ? "case" : "cases") + "</div>" +
        stateChip(code) + '<div class="sb">Core at ' + half + ' &middot; Super at ' + full + "</div></div>";
    }).join("");
    return '<div class="m3-varh">Where each business unit stands, ' + esc(dayLabelY(last[0])) + " to " + esc(dayLabelY(last[1])) + (days < 90 ? " (" + days + " days, a partial bucket)" : "") + '</div><div class="stance">' + items + "</div>";
  }
  function ddRender() {
    var box = byId("dd-chart"), rows = DRILL;
    if (!box) return;
    if (!rows) { box.innerHTML = '<p class="dt-note">Loading history&hellip;</p>'; return; }
    var built = buildSeries(rows);
    byId("dd-stance").innerHTML = stanceHTML(rows, built);
    if (!built) { box.innerHTML = '<p class="dt-note">No history in this range.</p>'; return; }
    var dataMax = 1;
    built.series.forEach(function (s) { s.vals.forEach(function (v) { if (v > dataMax) dataMax = v; }); });
    box.innerHTML = catChart({ series: built.series, labels: built.labels, totals: built.totals, spans: built.spans, fmt: fmtV, guides: guidesFor(built.series, dataMax), h: 300 }) + catLegend(built.series);
    wireCharts(box);
    var body = byId("cd-body");
    if (body && !body.hidden) cdRender();
  }
  function ddRangeUI(rows) {
    var minD = ddMin = ddBasisMin(rows), maxD = todayStr();
    if (!dd.to || dd.to > maxD) dd.to = maxD;
    if (!dd.from || dd.from < minD) dd.from = anchorFrom(minD, dd.to);
    if (dd.from > dd.to) dd.from = dd.to;
    var span = Math.max(dDiff(minD, maxD), 1);
    byId("dd-range").innerHTML =
      '<input type="date" id="dd-from-d" min="' + minD + '" max="' + maxD + '" value="' + dd.from + '" aria-label="Start date">' +
      '<div class="dd-slider"><div class="track"></div><div class="fill" id="dd-fill"></div>' +
        '<input type="range" id="dd-from" min="0" max="' + span + '" value="' + dDiff(minD, dd.from) + '" aria-label="Start of range">' +
        '<input type="range" id="dd-to" min="0" max="' + span + '" value="' + dDiff(minD, dd.to) + '" aria-label="End of range"></div>' +
      '<input type="date" id="dd-to-d" min="' + minD + '" max="' + maxD + '" value="' + dd.to + '" aria-label="End date">';
    function fill() {
      var a = dDiff(minD, dd.from) / span, b = dDiff(minD, dd.to) / span, el = byId("dd-fill");
      el.style.left = "calc(8px + (100% - 16px) * " + a.toFixed(4) + ")";
      el.style.width = "calc((100% - 16px) * " + Math.max(0, b - a).toFixed(4) + ")";
    }
    function sync() { byId("dd-from").value = String(dDiff(minD, dd.from)); byId("dd-to").value = String(dDiff(minD, dd.to)); byId("dd-from-d").value = dd.from; byId("dd-to-d").value = dd.to; fill(); }
    function live() {
      var a = parseInt(byId("dd-from").value, 10), b = parseInt(byId("dd-to").value, 10);
      if (a > b) { var t = a; a = b; b = t; }
      dd.from = dAdd(minD, a); dd.to = dAdd(minD, b);
      byId("dd-from-d").value = dd.from; byId("dd-to-d").value = dd.to; fill();
    }
    function done() { live(); ddRender(); }
    function dates() {
      var a = byId("dd-from-d").value || minD, b = byId("dd-to-d").value || maxD;
      if (a < minD) a = minD; if (b > maxD) b = maxD;
      if (a > b) { var t = a; a = b; b = t; }
      dd.from = a; dd.to = b; sync(); ddRender();
    }
    byId("dd-from").addEventListener("input", live); byId("dd-to").addEventListener("input", live);
    byId("dd-from").addEventListener("change", done); byId("dd-to").addEventListener("change", done);
    byId("dd-from-d").addEventListener("change", dates); byId("dd-to-d").addEventListener("change", dates);
    ["dd-from-d", "dd-to-d"].forEach(function (id) { var el = byId(id); el.title = "Click to pick a date"; el.addEventListener("click", function () { try { el.showPicker(); } catch (e) { /* not supported */ } }); });
    fill();
  }
  function ddControls(rows) {
    var ans = {}, isMB2 = (H && H.partner === "MB2") || /mb2/.test(KEY);
    rows.forEach(function (r) { if (r.an) ans[r.an] = r.dr_name || r.an; });
    var anKeys = Object.keys(ans).sort(), nameCount = {};
    anKeys.forEach(function (k) { var nm = ans[k] || k; nameCount[nm] = (nameCount[nm] || 0) + 1; });
    var docSel = anKeys.length > 1 ? '<select id="dd-an" aria-label="Account"><option value="">' + (isMB2 ? "All doctors" : "All accounts") + "</option>" +
      anKeys.map(function (k) { var nm = ans[k] || k; return '<option value="' + esc(k) + '">' + esc(nameCount[nm] > 1 ? nm + " (" + k + ")" : nm) + "</option>"; }).join("") + "</select>" : "";
    byId("dd-controls").innerHTML =
      '<select id="dd-basis" aria-label="Date basis"><option value="recv">Received</option><option value="inv">Invoiced</option></select>' +
      '<select id="dd-metric" aria-label="Measure"><option value="cases">Cases</option><option value="units">Units</option><option value="revenue">Revenue</option></select>' +
      '<select id="dd-gran" aria-label="Grouping"><option value="quarter">By quarter</option><option value="month">By month</option><option value="week">By week</option><option value="day">By day</option></select>' + docSel +
      '<select id="dd-roll" aria-label="Buckets"><option value="0">No buckets</option><option value="7">7 day buckets</option><option value="30">30 day buckets</option><option value="90">90 day buckets</option></select>';
    function wire(id, key, num) {
      var el = byId(id);
      if (!el) return;
      el.value = num ? String(dd[key]) : dd[key];
      el.addEventListener("change", function (e) {
        dd[key] = num ? parseInt(e.target.value, 10) : e.target.value;
        var g = byId("dd-gran");
        if (g) g.disabled = dd.roll > 0;
        if (id === "dd-basis") { dd.from = ""; dd.to = ""; ddRangeUI(rows); }
        else if (id === "dd-roll") { dd.from = anchorFrom(ddMin, dd.to); ddRangeUI(rows); }
        ddRender();
      });
    }
    wire("dd-basis", "basis"); wire("dd-metric", "metric"); wire("dd-gran", "gran"); wire("dd-an", "an"); wire("dd-roll", "roll", true);
    var g = byId("dd-gran"); if (g) g.disabled = dd.roll > 0;
    ddRangeUI(rows);
  }
  function cdRender() {
    var body = byId("cd-body"), rows = CASES;
    if (!body) return;
    if (!rows) { body.innerHTML = '<p class="dt-note">Loading cases&hellip;</p>'; return; }
    var dk = dd.basis === "inv" ? "inv" : "recv", CAP = 500;
    var f = rows.filter(function (c) { return c[dk] && c[dk] >= dd.from && c[dk] <= dd.to && (!dd.an || c.an === dd.an); }).sort(function (a, b) { return a[dk] < b[dk] ? 1 : -1; });
    var trs = f.slice(0, CAP).map(function (c) {
      var stt = c.status || "";
      return "<tr><td><b>" + esc(c.cn || "") + "</b></td><td>" + (stt ? '<span class="stchip" style="background:' + (/hold/i.test(stt) ? "rgba(239,68,68,.12);color:#B0362F" : /wip/i.test(stt) ? "rgba(24,130,199,.16);color:#0F6BA8" : "rgba(5,32,48,.1);color:#052030") + '">' + esc(stt) + "</span>" : "") + "</td>" +
        '<td class="wrap">' + esc(c.product || "") + '</td><td>' + esc(c.recv ? longDate(c.recv) : "") + "</td><td>" + esc(c.inv ? longDate(c.inv) : "") + '</td><td class="r">' + (Math.round((+c.q_units || 0) * 10) / 10) + '</td><td class="r">' + fmtMoney(+c.revenue || 0) + "</td></tr>";
    }).join("");
    body.innerHTML = '<div class="dt-wrap"><table class="dt"><thead><tr><th>Case</th><th>Status</th><th>Product</th><th>Received</th><th>Invoiced</th><th class="r">Units</th><th class="r">Revenue</th></tr></thead><tbody>' +
      (trs || '<tr><td colspan="7" class="ph">No cases in this range.</td></tr>') + "</tbody></table></div>" +
      '<p class="dt-note">' + fmtN(f.length) + " cases in this range" + (f.length > CAP ? ", showing the latest " + CAP : "") + ", newest first by " + (dk === "inv" ? "invoice" : "received") + " date.</p>";
  }
  function ddInit() {
    var chart = byId("dd-chart"), btn = byId("cd-toggle");
    if (!chart) return;
    if (typeof fetch !== "function") { ddFallback(); return; }
    rpcFetch("cs_v9_drill").then(function (rows) { DRILL = rows; ddControls(rows); ddRender(); }).catch(function () { ddFallback(); });
    if (btn) btn.addEventListener("click", function () {
      var body = byId("cd-body");
      body.hidden = !body.hidden;
      btn.textContent = body.hidden ? "Show all cases in this period" : "Hide the case list";
      if (!body.hidden) {
        if (CASES) { cdRender(); return; }
        cdRender();
        rpcFetch("cs_v9_case_drill").then(function (rows) { CASES = rows; cdRender(); }).catch(function () { body.innerHTML = '<p class="dt-note">The case list is unavailable right now.</p>'; });
      }
    });
    ddTimer = setInterval(function () {
      if (!byId("dd-chart")) { clearInterval(ddTimer); ddTimer = null; return; }
      rpcFetch("cs_v9_drill").then(function (rows) {
        DRILL = rows; ddRender();
        var body = byId("cd-body");
        if (body && !body.hidden) rpcFetch("cs_v9_case_drill").then(function (cr) { CASES = cr; cdRender(); }).catch(function () { /* keep the old list */ });
      }).catch(function () { /* keep the old chart */ });
    }, 900000);
  }
  function ddFallback() {
    var card = byId("vol-card");
    if (!card) return;
    card.innerHTML = '<div class="spark-h">Volume over time</div><p class="dt-note">Live history is unavailable right now; this is the month by month view from the last model run.</p>' + fallbackHTML();
    wireFallback();
  }
  var volume = '<div class="card" id="vol-card"><div class="spark-h">Volume over time</div>' +
    '<div class="bar" id="dd-controls"></div><div class="bar" id="dd-range"></div>' +
    '<div id="dd-chart"><p class="dt-note">Loading history&hellip;</p></div><div id="dd-stance"></div>' +
    '<p class="dt-note">Received = when the case arrived; invoiced = when it billed. Units count only main products. Buckets group the range into fixed 7, 30, or 90 day windows counted from the left date, and the left date is set so the last bucket ends today. Pick 90 day buckets to see where the practice stands: that is the window behind Core Active and Super Active, and the dashed lines are the bars for the business units on the chart. Refreshes automatically every 15 minutes.</p>' +
    '<button class="xbtn" id="cd-toggle" type="button">Show all cases in this period</button><div id="cd-body" hidden></div></div>';

  /* open cases and category table */
  var open = (H && H.open_cases) || [];
  var openHtml = '<div class="card"><div class="spark-h">Cases in the lab right now' + (open.length ? " (" + open.length + ")" : "") + "</div>" +
    (open.length ? '<div class="dt-wrap"><table class="dt"><thead><tr><th>Case</th><th>Received</th><th>Status</th><th>Step</th><th>Product</th><th>Hold reason</th><th class="r">Days</th></tr></thead><tbody>' +
      open.slice(0, 60).map(function (c) { return "<tr><td>" + esc(c.cn) + "</td><td>" + esc(longDate(c.recv)) + "</td><td>" + esc(c.status) + "</td><td>" + esc(c.step) + "</td><td>" + esc(c.product) + "</td><td>" + (c.hold_reason ? '<span class="hold">' + esc(c.hold_reason) + "</span>" : "") + '</td><td class="r">' + fmtN(c.days) + "</td></tr>"; }).join("") + "</tbody></table></div>"
      : '<p class="dt-note">' + (H ? "Nothing open in the lab for this practice." : "Open case detail comes from the Account Health model, which does not cover this practice.") + "</p>") + "</div>";
  var ls = (H && H.line_states) || {};
  var catRows = Object.keys(ls).map(function (k) { var L = ls[k], d = (L.q1 || 0) - (L.q2 || 0); return "<tr><td><b>" + esc(LINES[k] || k) + "</b></td><td>" + esc(String(L.state || "").replace("_", " ").toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); })) + (L.at_risk ? ' <span class="hold">at risk</span>' : "") + '</td><td class="r">' + fmtN(L.q2) + '</td><td class="r">' + fmtN(L.q1) + '</td><td class="r ' + (d > 0 ? "up" : d < 0 ? "dn" : "") + '">' + (d > 0 ? "+" : "") + fmtN(d) + "</td></tr>"; }).join("");
  var cats = '<div class="card"><div class="spark-h">Product categories</div>' + (catRows ? '<table class="dt"><thead><tr><th>Line</th><th>State</th><th class="r">Prior 90 days</th><th class="r">Last 90 days</th><th class="r">Change</th></tr></thead><tbody>' + catRows + "</tbody></table>" : '<p class="dt-note">No line history in the model for this practice.</p>') + "</div>";

  byId("acct").innerHTML = alert + hero + volume + stands + brief + why + '<div class="grid2">' + openHtml + cats + "</div>" +
    (H ? "" : '<p class="dt-note" style="margin-top:12px">This practice is outside the Account Health modeled book, so predictions, the AI summary and open cases are not available; the state and history above come from the Daily Commercial Performance engine.</p>');

  ddInit();
})();
