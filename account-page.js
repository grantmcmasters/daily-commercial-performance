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
  if (!row) {
    byId("acct").innerHTML = '<div class="card"><div class="sub-title">Practice not found</div><p class="dt-note">Open this page from a row on the account details list.</p></div>';
    return;
  }
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

  /* volume over time */
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
  var volume = '<div class="card"><div class="spark-h">Volume over time</div>' +
    '<div class="seg-row" id="vol-controls"><div class="seg" data-dim="unit"><button type="button" data-v="c" class="on">Cases</button><button type="button" data-v="r"' + (H ? "" : " disabled") + '>Revenue</button></div>' +
    '<div class="seg" data-dim="by"><button type="button" data-v="month" class="on">By month</button><button type="button" data-v="week"' + (H && H.weekly ? "" : " disabled") + '>By week</button></div>' +
    '<div class="legend">' + legend + "</div></div>" +
    '<div id="vol-chart">' + volChart() + "</div>" +
    '<p class="dt-note">' + (H ? "Received date; the last month is to date. Revenue is invoiced dollars by category from the Account Health model." : "Received date, this year, from the Daily Commercial Performance engine; the last month is to date.") + "</p></div>";

  /* open cases and category table */
  var open = (H && H.open_cases) || [];
  var openHtml = '<div class="card"><div class="spark-h">Cases in the lab right now' + (open.length ? " (" + open.length + ")" : "") + "</div>" +
    (open.length ? '<div class="dt-wrap"><table class="dt"><thead><tr><th>Case</th><th>Received</th><th>Status</th><th>Step</th><th>Product</th><th>Hold reason</th><th class="r">Days</th></tr></thead><tbody>' +
      open.slice(0, 60).map(function (c) { return "<tr><td>" + esc(c.cn) + "</td><td>" + esc(longDate(c.recv)) + "</td><td>" + esc(c.status) + "</td><td>" + esc(c.step) + "</td><td>" + esc(c.product) + "</td><td>" + (c.hold_reason ? '<span class="hold">' + esc(c.hold_reason) + "</span>" : "") + '</td><td class="r">' + fmtN(c.days) + "</td></tr>"; }).join("") + "</tbody></table></div>"
      : '<p class="dt-note">' + (H ? "Nothing open in the lab for this practice." : "Open case detail comes from the Account Health model, which does not cover this practice.") + "</p>") + "</div>";
  var ls = (H && H.line_states) || {};
  var catRows = Object.keys(ls).map(function (k) { var L = ls[k], d = (L.q1 || 0) - (L.q2 || 0); return "<tr><td><b>" + esc(LINES[k] || k) + "</b></td><td>" + esc(String(L.state || "").replace("_", " ").toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); })) + (L.at_risk ? ' <span class="hold">at risk</span>' : "") + '</td><td class="r">' + fmtN(L.q2) + '</td><td class="r">' + fmtN(L.q1) + '</td><td class="r ' + (d > 0 ? "up" : d < 0 ? "dn" : "") + '">' + (d > 0 ? "+" : "") + fmtN(d) + "</td></tr>"; }).join("");
  var cats = '<div class="card"><div class="spark-h">Product categories</div>' + (catRows ? '<table class="dt"><thead><tr><th>Line</th><th>State</th><th class="r">Prior 90 days</th><th class="r">Last 90 days</th><th class="r">Change</th></tr></thead><tbody>' + catRows + "</tbody></table>" : '<p class="dt-note">No line history in the model for this practice.</p>') + "</div>";

  byId("acct").innerHTML = alert + hero + stands + brief + volume + why + '<div class="grid2">' + openHtml + cats + "</div>" +
    (H ? "" : '<p class="dt-note" style="margin-top:12px">This practice is outside the Account Health modeled book, so predictions, the AI summary and open cases are not available; the state and history above come from the Daily Commercial Performance engine.</p>');

  byId("vol-controls").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest(".seg button") : null;
    if (!b || b.disabled) return;
    [].forEach.call(b.parentNode.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
    mode[b.parentNode.getAttribute("data-dim")] = b.getAttribute("data-v");
    byId("vol-chart").innerHTML = volChart();
  });
})();
