/* Daily Commercial Performance: account details page.
   Reads details.js (window.DCP_DETAILS) and shows every practice behind each tile of one section,
   its state today and at each month end this year, and its case submissions by month. */
(function () {
  "use strict";
  var D = window.DCP_DETAILS || { meta: {}, sections: {} };
  var byId = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var SEC = q.get("sec") || "ae", KEY = q.get("key") || "", METRIC = q.get("metric") || "";
  var SECTION_NAMES = { ae: "Account Executives", am: "Account Managers", programs: "Programs" };
  var STATE = { "0": { label: "Inactive", color: "#EF4444", bg: "rgba(239,68,68,.14)", ink: "#B0362F" }, "1": { label: "Dabbler", color: "#4ABEEE", bg: "rgba(74,190,238,.22)", ink: "#0F6BA8" },
                "2": { label: "Core Active", color: "#1882C7", bg: "rgba(24,130,199,.18)", ink: "#0F6BA8" }, "3": { label: "Super Active", color: "#052030", bg: "rgba(5,32,48,.16)", ink: "#052030" } };
  var months = D.meta.months || [];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtN(n) { return (n == null) ? "--" : Number(n).toLocaleString("en-US"); }
  function fmtPct(p) { return (p == null) ? "--" : Math.round(p) + "%"; }
  function longDate(iso) {
    if (!iso) return "";
    try { var p = iso.split("-"); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(+p[0], +p[1] - 1, +p[2])); } catch (e) { return iso; }
  }
  function st(r) { return +r.st; }
  function lastMonth(r) { return r.cm && r.cm.length ? r.cm[r.cm.length - 1] : 0; }

  /* ---------- the tiles: label, value and the practices behind it ---------- */
  function metricsFor(sec, S) {
    var rows = S.rows, active = rows.filter(function (r) { return st(r) >= 2; }).length;
    var last = months.length ? months[months.length - 1] : "MTD";
    if (sec === "ae") {
      return [
        { key: "total", label: "Total practices", value: fmtN(S.network), sub: fmtN(S.in_system) + " in our system", filter: function () { return true; }, note: "The network is " + fmtN(S.network) + " practices; the list holds the " + fmtN(S.in_system) + " with an account in our system." },
        { key: "active", label: "Active", filter: function (r) { return st(r) >= 2; }, tone: "g" },
        { key: "super", label: "Super Active", filter: function (r) { return st(r) === 3; }, tone: "g" },
        { key: "core", label: "Core Active", filter: function (r) { return st(r) === 2; }, tone: "g" },
        { key: "dabblers", label: "Dabblers", filter: function (r) { return st(r) === 1; } },
        { key: "inactive", label: "Inactive", filter: function (r) { return st(r) === 0; }, tone: "q" },
        { key: "penetration", label: "Penetration", value: fmtPct(S.network ? 100 * active / S.network : null), sub: fmtN(active) + " / " + fmtN(S.network) + " offices currently active", filter: function (r) { return st(r) >= 2; }, tone: "d" },
        { key: "mtd_net_new", label: "MTD net new submitters", filter: function (r) { return r["new"] === 1; }, tone: "g" },
        { key: "submitters_ytd", label: "Submitters YTD", filter: function (r) { return r.ytd > 0; }, tone: "g" }
      ];
    }
    if (sec === "am") {
      return [
        { key: "book", label: "Practices in the book", filter: function () { return true; } },
        { key: "submitters_ytd", label: "Submitters YTD", filter: function (r) { return r.ytd > 0; }, tone: "g" },
        { key: "cases_mtd", label: "Submitted in " + last, filter: function (r) { return lastMonth(r) > 0; }, sort: function (a, b) { return lastMonth(b) - lastMonth(a); }, tone: "g" },
        { key: "active_now", label: "Active today", filter: function (r) { return st(r) >= 2; }, tone: "g" },
        { key: "dabblers", label: "Dabblers", filter: function (r) { return st(r) === 1; } },
        { key: "up30", label: "Became active L30D", filter: function (r) { return +r.l30 < 2 && st(r) >= 2; }, tone: "up" },
        { key: "down30", label: "Lost active status L30D", filter: function (r) { return +r.l30 >= 2 && st(r) < 2; }, tone: "dn" },
        { key: "cohort", label: "Active at start of " + (S.quarter || "the quarter"), filter: function (r) { return +r.q0 >= 2; }, tone: "g" },
        { key: "stayed", label: "Still active", filter: function (r) { return +r.q0 >= 2 && st(r) >= 2; }, tone: "up" },
        { key: "to_dabbler", label: "Now dabbler", filter: function (r) { return +r.q0 >= 2 && st(r) === 1; } },
        { key: "to_inactive", label: "Now inactive", filter: function (r) { return +r.q0 >= 2 && st(r) === 0; }, tone: "dn" },
        { key: "joined", label: "Newly active since " + (S.quarter ? S.quarter.split(" ")[0] + " start" : "quarter start"), filter: function (r) { return +r.q0 < 2 && st(r) >= 2; }, tone: "up" }
      ];
    }
    return [
      { key: "book", label: "Practices in the program", filter: function () { return true; } },
      { key: "submitters_ytd", label: "Submitters YTD", filter: function (r) { return r.ytd > 0; }, tone: "g" },
      { key: "active", label: "Active", filter: function (r) { return st(r) >= 2; }, tone: "g" },
      { key: "dabblers", label: "Dabblers", filter: function (r) { return st(r) === 1; } },
      { key: "inactive", label: "Inactive", sub: "submitted this year, nothing in 90 days", filter: function (r) { return r.ytd > 0 && st(r) === 0; }, tone: "q" },
      { key: "penetration", label: "Penetration", value: fmtPct(rows.length ? 100 * active / rows.length : null), sub: fmtN(active) + " / " + fmtN(rows.length) + " offices currently active", filter: function (r) { return st(r) >= 2; }, tone: "d" },
      { key: "new_mtd", label: "New submitters in " + last, filter: function (r) { return r["new"] === 1; }, tone: "g" }
    ];
  }

  /* ---------- rendering ---------- */
  var S = (D.sections[SEC] || {})[KEY], METRICS = [], current = null, sortKey = "name", sortDir = 1, query = "", showAll = false;
  if (!S) {
    byId("dt-head").innerHTML = '<div class="sub-title">No details for this section yet</div><p class="dt-note">Open this page from a "Click for details" button on the one pager.</p>';
    return;
  }
  METRICS = metricsFor(SEC, S);
  document.title = S.title + " Account Details";
  byId("asof").textContent = "Data through " + longDate(D.meta.data_through || D.meta.run_date);

  function logoHTML() {
    var logos = S.logos || (S.logo ? [S.logo] : []);
    return logos.map(function (p) { return '<img class="sub-logo' + (logos.length > 1 ? " sm" : "") + (/aspen-beacon/.test(p) ? " tall" : "") + '" src="' + esc(p) + '" alt="" onerror="this.style.display=\'none\'">'; }).join("");
  }
  byId("dt-head").innerHTML =
    '<div class="sub-brand"><div class="sub-logos">' + logoHTML() + '</div><div><div class="dt-kicker">' + esc(SECTION_NAMES[SEC] || "") + ' &middot; account details</div><div class="sub-title">' + esc(S.title) + '</div></div></div>' +
    '<div><span class="chip chip-b">' + esc(S.owner || "") + "</span></div>";

  function countOf(m) { return S.rows.filter(m.filter).length; }
  function renderTiles() {
    byId("dt-tiles").innerHTML = METRICS.map(function (m) {
      return '<button type="button" class="b3t tile-btn ' + (m.tone || "") + (current && current.key === m.key ? " on" : "") + '" data-metric="' + esc(m.key) + '">' +
        '<div class="n">' + esc(m.value != null ? m.value : fmtN(countOf(m))) + '</div><div class="t">' + esc(m.label) + '</div>' + (m.sub ? '<div class="rv">' + esc(m.sub) + "</div>" : "") + "</button>";
    }).join("");
  }
  byId("dt-tiles").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest(".tile-btn") : null;
    if (!b) return;
    select(b.getAttribute("data-metric"));
  });
  function select(key) {
    current = METRICS.filter(function (m) { return m.key === key; })[0] || METRICS[0];
    showAll = false;
    try { history.replaceState(null, "", location.pathname + "?sec=" + SEC + "&key=" + encodeURIComponent(KEY) + "&metric=" + current.key); } catch (e) { /* ignore */ }
    renderTiles();
    renderTable();
  }

  function stateChip(code) { var s = STATE[code] || STATE["0"]; return '<span class="stchip" style="background:' + s.bg + ';color:' + s.ink + '">' + s.label + "</span>"; }
  function movement(r) {
    return '<span class="mv">' + (r.hist || "").split("").map(function (c, i) { var s = STATE[c] || STATE["0"]; return '<i style="background:' + s.color + '" title="' + esc(months[i] || "") + ": " + s.label + '"></i>'; }).join("") + "</span>";
  }
  function spark(r) {
    var cm = r.cm || [], max = Math.max.apply(null, cm.concat([1])), w = 9, gap = 2, W = cm.length * (w + gap), H = 22;
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + cm.map(function (v, i) {
      var h = v > 0 ? Math.max(2, Math.round((v / max) * (H - 2))) : 0;
      return '<rect x="' + (i * (w + gap)) + '" y="' + (H - h) + '" width="' + w + '" height="' + h + '" fill="#1882C7" fill-opacity="' + (i === cm.length - 1 ? 1 : 0.62) + '"><title>' + esc(months[i] || "") + ": " + v + "</title></rect>";
    }).join("") + "</svg>";
  }
  var COLS = [
    { key: "pid", label: "Practice ID", get: function (r) { return r.pid; } },
    { key: "name", label: "Practice", get: function (r) { return r.name; } },
    { key: "acc", label: "Accounts", get: function (r) { return (r.acc || []).join(", "); } },
    { key: "st", label: "State today", get: function (r) { return st(r); }, html: function (r) { return stateChip(r.st); } },
    { key: "hist", label: "Movement " + (months.length ? months[0] + " to " + months[months.length - 1] : "this year"), get: function (r) { return r.hist; }, html: movement, nosort: true },
    { key: "cm", label: "Cases by month", get: function (r) { return r.ytd; }, html: spark, nosort: true },
    { key: "mtd", label: months.length ? months[months.length - 1] : "MTD", get: lastMonth, num: true },
    { key: "ytd", label: "YTD", get: function (r) { return r.ytd; }, num: true },
    { key: "c90", label: "Last 90 days", get: function (r) { return r.c90; }, num: true },
    { key: "p90", label: "Prior 90 days", get: function (r) { return r.p90; }, num: true },
    { key: "first", label: "First case", get: function (r) { return r.first || ""; }, html: function (r) { return esc(longDate(r.first)); } },
    { key: "last", label: "Last case", get: function (r) { return r.last || ""; }, html: function (r) { return esc(longDate(r.last)); } }
  ];
  function matches(r) {
    if (!query) return true;
    var s = (r.pid + " " + r.name + " " + (r.acc || []).join(" ")).toLowerCase();
    return s.indexOf(query) >= 0;
  }
  function selected() {
    var rows = S.rows.filter(current.filter).filter(matches);
    var col = COLS.filter(function (c) { return c.key === sortKey; })[0];
    if (current.sort && sortKey === "name" && !query) rows.sort(current.sort);
    else if (col) rows.sort(function (a, b) { var x = col.get(a), y = col.get(b); if (x == null) x = ""; if (y == null) y = ""; return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    return rows;
  }
  function renderTable() {
    var rows = selected(), shown = showAll ? rows : rows.slice(0, 400);
    byId("dt-count").innerHTML = "<b>" + fmtN(rows.length) + "</b> practices in <b>" + esc(current.label) + "</b>" + (current.note ? ' <span class="dt-note">' + esc(current.note) + "</span>" : "") + (rows.length > shown.length ? ' <button type="button" class="linkbtn" id="dt-more">Show all ' + fmtN(rows.length) + "</button>" : "");
    var head = "<tr>" + COLS.map(function (c) { return '<th class="' + (c.num ? "r" : "") + (c.nosort ? "" : " sortable") + (sortKey === c.key ? " sorted" : "") + '" data-col="' + c.key + '">' + esc(c.label) + (sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : "") + "</th>"; }).join("") + "</tr>";
    var body = shown.map(function (r) {
      return "<tr>" + COLS.map(function (c) { return '<td class="' + (c.num ? "r" : "") + '">' + (c.html ? c.html(r) : esc(c.get(r))) + "</td>"; }).join("") + "</tr>";
    }).join("") || '<tr><td colspan="' + COLS.length + '" class="ph">No practices match.</td></tr>';
    byId("dt-table").innerHTML = "<thead>" + head + "</thead><tbody>" + body + "</tbody>";
    var more = byId("dt-more");
    if (more) more.addEventListener("click", function () { showAll = true; renderTable(); });
  }
  byId("dt-table").addEventListener("click", function (ev) {
    var th = ev.target.closest ? ev.target.closest("th.sortable") : null;
    if (!th) return;
    var k = th.getAttribute("data-col");
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    renderTable();
  });
  byId("dt-search").addEventListener("input", function (ev) { query = ev.target.value.trim().toLowerCase(); showAll = false; renderTable(); });

  /* ---------- export: a csv that opens straight in Excel ---------- */
  byId("dt-export").addEventListener("click", function () {
    var rows = selected(), head = ["Practice ID", "Practice", "Accounts", "State today", "Active at " + (S.quarter ? "start of " + S.quarter : "quarter start"), "State 30 days ago"]
      .concat(months.map(function (m) { return "State end of " + m; }))
      .concat(months.map(function (m) { return "Cases " + m; }))
      .concat(["Cases YTD", "Cases last 90 days", "Cases prior 90 days", "First case", "Last case", "New this month"]);
    function cell(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [head.map(cell).join(",")];
    rows.forEach(function (r) {
      var vals = [r.pid, r.name, (r.acc || []).join("; "), STATE[r.st].label, STATE[r.q0].label, STATE[r.l30].label]
        .concat((r.hist || "").split("").map(function (c) { return STATE[c].label; }))
        .concat(r.cm || [])
        .concat([r.ytd, r.c90, r.p90, r.first || "", r.last || "", r["new"] ? "Yes" : "No"]);
      lines.push(vals.map(cell).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (S.title + " - " + current.label + " - " + (D.meta.data_through || "")).replace(/[\\/:*?"<>|]/g, " ") + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  select(METRIC);
})();
