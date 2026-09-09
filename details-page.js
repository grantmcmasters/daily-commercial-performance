/* Daily Commercial Performance: the Details list.
   One sentence says which practices are on the list and why; the list itself is plain. Every number on the
   one pager links here with a metric code; the quick buttons cover the everyday views. */
(function () {
  "use strict";
  var D = window.DCP_DETAILS || { meta: {}, sections: {} };
  var byId = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var SEC = q.get("sec") || "ae", KEY = q.get("key") || "", METRIC = q.get("metric") || "";
  var SECTION_NAMES = { ae: "Account Executives", am: "Account Managers", programs: "Programs" };
  var STATE = { "0": { label: "Inactive", bg: "rgba(239,68,68,.12)", ink: "#B0362F" }, "1": { label: "Dabbler", bg: "rgba(74,190,238,.2)", ink: "#0F6BA8" },
                "2": { label: "Core Active", bg: "rgba(24,130,199,.16)", ink: "#0F6BA8" }, "3": { label: "Super Active", bg: "rgba(5,32,48,.14)", ink: "#052030" } };
  var BU = { CB: "Crown and Bridge", REM: "Removables", IMP: "Implants", FA: "Full Arch", HE: "High Esthetics" };
  var months = D.meta.months || [], starts = D.meta.month_starts || [], qweeks = D.meta.qweeks || [], yweeks = D.meta.yweeks || [];
  var quarter = D.meta.quarter || "the quarter", year = D.meta.year || "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtN(n) { return (n == null) ? "--" : Number(n).toLocaleString("en-US"); }
  function longDate(iso) { if (!iso) return ""; try { var p = iso.split("-"); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(+p[0], +p[1] - 1, +p[2])); } catch (e) { return iso; } }
  function st(r) { return +r.st; }
  function lastIdx() { return Math.max(0, months.length - 1); }
  function lastMonth(r) { return r.cm && r.cm.length ? r.cm[r.cm.length - 1] : 0; }
  function inMonth(r, i) { var a = starts[i], b = starts[i + 1]; return !!(r.first && a && r.first >= a && (!b || r.first < b)); }
  function code(c) { return STATE[String(c)] ? STATE[String(c)].label : "?"; }
  function stateAt(str, i) { return (str || "").charAt(i) || "0"; }

  var S = (D.sections[SEC] || {})[KEY];
  if (!S) {
    byId("dt-head").innerHTML = '<div class="sub-title">Pick a page first</div>';
    byId("dt-lead").innerHTML = '<p class="dt-note">Open Details from any partner, account manager or program on the main screen, or from any number there.</p>';
    return;
  }
  document.title = S.title + " Account Details";
  byId("asof").textContent = "Data through " + longDate(D.meta.data_through || D.meta.run_date);
  function logoHTML() {
    var logos = S.logos || (S.logo ? [S.logo] : []);
    return logos.map(function (p) { return '<img class="sub-logo' + (logos.length > 1 ? " sm" : "") + (/aspen-beacon/.test(p) ? " tall" : "") + '" src="' + esc(p) + '" alt="" onerror="this.style.display=\'none\'">'; }).join("");
  }
  byId("dt-head").innerHTML =
    '<div class="sub-brand"><div class="sub-logos">' + logoHTML() + '</div><div><div class="dt-kicker">' + esc(SECTION_NAMES[SEC] || "") + '</div><div class="sub-title">' + esc(S.title) + '</div></div></div>' +
    '<div><span class="chip chip-b">' + esc(S.owner || "") + "</span></div>";

  /* ---------- what a metric code means ---------- */
  var monthLabel = function (i) { return (months[i] || "that month").replace(" MTD", ""); };
  var weekLabel = function (list, i) { var w = list[i]; return w ? "the week of " + w.label : "that week"; };
  function up(a, b) { return +a < 2 && +b >= 2; }
  function view(m) {
    var last = lastIdx(), parts = (m || "").split(":"), k = parts[0], i = +parts[1], c = parts[2];
    var V = { key: m || "total", cols: [] };
    switch (k) {
      case "": case "total": case "book":
        V.title = SEC === "ae" ? "All " + fmtN(S.rows.length) + " practices in our system" : "All practices in the " + (SEC === "am" ? "book" : "program");
        V.filter = function () { return true; }; break;
      case "active": case "penetration": case "active_now":
        V.title = "Active today (Core or Super Active)"; V.filter = function (r) { return st(r) >= 2; }; break;
      case "super": V.title = "Super Active today"; V.filter = function (r) { return st(r) === 3; }; break;
      case "core": V.title = "Core Active today"; V.filter = function (r) { return st(r) === 2; }; break;
      case "dabblers": V.title = "Dabblers today"; V.filter = function (r) { return st(r) === 1; }; break;
      case "inactive":
        if (SEC === "programs") { V.title = "Sent a case this year, nothing in the last 90 days"; V.filter = function (r) { return r.ytd > 0 && st(r) === 0; }; }
        else { V.title = "Inactive today"; V.filter = function (r) { return st(r) === 0; }; }
        break;
      case "submitters_ytd": V.title = "Submitted at least one case this year"; V.filter = function (r) { return r.ytd > 0; }; break;
      case "cases_mtd": V.title = "Submitted a case in " + monthLabel(last); V.filter = function (r) { return lastMonth(r) > 0; }; V.sort = function (a, b) { return lastMonth(b) - lastMonth(a); }; break;
      case "mtd_net_new": case "new_mtd": V.title = "First ever case in " + monthLabel(last); V.filter = function (r) { return r["new"] === 1; }; break;
      case "up30": V.title = "Became active in the last 30 days"; V.filter = function (r) { return +r.l30 < 2 && st(r) >= 2; }; V.cols = [["30 days ago", function (r) { return r.l30; }]]; break;
      case "down30": V.title = "Lost active status in the last 30 days"; V.filter = function (r) { return +r.l30 >= 2 && st(r) < 2; }; V.cols = [["30 days ago", function (r) { return r.l30; }]]; break;
      case "cohort": V.title = "Active at the start of " + quarter; V.filter = function (r) { return +r.q0 >= 2; }; V.cols = [["Start of " + quarter, function (r) { return r.q0; }]]; break;
      case "stayed": V.title = "Active at the start of " + quarter + " and still active"; V.filter = function (r) { return +r.q0 >= 2 && st(r) >= 2; }; V.cols = [["Start of " + quarter, function (r) { return r.q0; }]]; break;
      case "to_dabbler": V.title = "Active at the start of " + quarter + ", a dabbler now"; V.filter = function (r) { return +r.q0 >= 2 && st(r) === 1; }; V.cols = [["Start of " + quarter, function (r) { return r.q0; }]]; break;
      case "to_inactive": V.title = "Active at the start of " + quarter + ", inactive now"; V.filter = function (r) { return +r.q0 >= 2 && st(r) === 0; }; V.cols = [["Start of " + quarter, function (r) { return r.q0; }]]; break;
      case "joined": V.title = "Became active since the start of " + quarter; V.filter = function (r) { return +r.q0 < 2 && st(r) >= 2; }; V.cols = [["Start of " + quarter, function (r) { return r.q0; }]]; break;
      case "m": V.title = code(c) + " at the end of " + monthLabel(i); V.filter = function (r) { return stateAt(r.hist, i) === c; }; V.cols = [["End of " + monthLabel(i), function (r) { return stateAt(r.hist, i); }]]; break;
      case "w": V.title = code(c) + " at the end of " + weekLabel(qweeks, i); V.filter = function (r) { return stateAt(r.wkq, i + 1) === c; }; V.cols = [["End of that week", function (r) { return stateAt(r.wkq, i + 1); }]]; break;
      case "wy": V.title = code(c) + " at the end of " + weekLabel(yweeks, i); V.filter = function (r) { return stateAt(r.wky, i + 1) === c; }; V.cols = [["End of that week", function (r) { return stateAt(r.wky, i + 1); }]]; break;
      case "new": V.title = "First ever case in " + monthLabel(i); V.filter = function (r) { return inMonth(r, i); }; break;
      case "neww": V.title = "First ever case in " + weekLabel(qweeks, i); V.filter = function (r) { var w = qweeks[i]; return !!(w && r.first && r.first >= w.start && r.first < w.end); }; break;
      case "newwy": V.title = "First ever case in " + weekLabel(yweeks, i); V.filter = function (r) { var w = yweeks[i]; return !!(w && r.first && r.first >= w.start && r.first < w.end); }; break;
      case "quiet": V.title = "Became inactive in " + monthLabel(i) + " (90 days without a case)"; V.filter = function (r) { return (r.qm || []).indexOf(i) >= 0; }; break;
      case "subm": V.title = "Submitted a case in " + monthLabel(i); V.filter = function (r) { return (r.cm || [])[i] > 0; }; V.cols = [[monthLabel(i) + " cases", function (r) { return (r.cm || [])[i]; }, true]]; break;
      case "seg":
        if (c === "new") { V.title = "New submitters in " + monthLabel(i); V.filter = function (r) { return inMonth(r, i); }; }
        else if (c === "active") { V.title = "Active submitters in " + monthLabel(i); V.filter = function (r) { return (r.cm || [])[i] > 0 && !inMonth(r, i) && +stateAt(r.hist, i) >= 2; }; }
        else { V.title = "Dabblers who submitted in " + monthLabel(i); V.filter = function (r) { return (r.cm || [])[i] > 0 && !inMonth(r, i) && +stateAt(r.hist, i) < 2; }; }
        V.cols = [[monthLabel(i) + " cases", function (r) { return (r.cm || [])[i]; }, true], ["End of " + monthLabel(i), function (r) { return stateAt(r.hist, i); }]];
        break;
      case "wow": {
        var kinds = { up: ["Dabbler to Active", function (a, b) { return up(a, b); }], super: ["Core Active to Super Active", function (a, b) { return a === "2" && b === "3"; }],
                      down: ["Active to Dabbler", function (a, b) { return +a >= 2 && +b < 2; }], inactive: ["Dabbler to Inactive", function (a, b) { return a === "1" && b === "0"; }] };
        var kd = kinds[c] || kinds.up;
        V.title = kd[0] + " in " + weekLabel(qweeks, i); V.filter = function (r) { return kd[1](stateAt(r.wkq, i), stateAt(r.wkq, i + 1)); };
        V.cols = [["Start of week", function (r) { return stateAt(r.wkq, i); }], ["End of week", function (r) { return stateAt(r.wkq, i + 1); }]];
        break;
      }
      default: V.title = "All practices"; V.filter = function () { return true; };
    }
    return V;
  }

  /* ---------- the quick views: the handful of lists a rep asks for every day ---------- */
  function quick() {
    var last = monthLabel(lastIdx());
    var list = [["active", "Active today"], ["super", "Super Active"], ["core", "Core Active"], ["dabblers", "Dabblers"], ["inactive", "Inactive"], ["up30", "Became active, last 30 days"], ["down30", "Lost active status, last 30 days"], ["mtd_net_new", "New in " + last], ["submitters_ytd", "Submitted this year"]];
    if (SEC === "am") list.push(["stayed", "Kept since " + quarter.split(" ")[0] + " start"], ["to_dabbler", "Active to dabbler this quarter"], ["to_inactive", "Active to inactive this quarter"]);
    list.push(["total", SEC === "ae" ? "Everyone" : "Whole " + (SEC === "am" ? "book" : "program")]);
    return list;
  }
  var current = view(METRIC), sortKey = "ytd", sortDir = -1, query = "", showAll = false;
  function renderQuick() {
    byId("dt-quick").innerHTML = quick().map(function (qv) {
      var n = S.rows.filter(view(qv[0]).filter).length;
      return '<button type="button" class="tile-btn' + (current.key === qv[0] ? " on" : "") + '" data-metric="' + esc(qv[0]) + '">' + esc(qv[1]) + ' <b>' + fmtN(n) + "</b></button>";
    }).join("");
  }
  byId("dt-quick").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest(".tile-btn") : null;
    if (!b) return;
    select(b.getAttribute("data-metric"));
  });
  function select(m) {
    current = view(m); showAll = false;
    try { history.replaceState(null, "", location.pathname + "?sec=" + SEC + "&key=" + encodeURIComponent(KEY) + "&metric=" + encodeURIComponent(current.key)); localStorage.setItem("dcp.lastDetails", location.search); } catch (e) { /* ignore */ }
    renderQuick(); renderTable();
  }

  /* ---------- the list ---------- */
  function stateChip(c) { var s = STATE[String(c)] || STATE["0"]; return '<span class="stchip" style="background:' + s.bg + ';color:' + s.ink + '">' + s.label + "</span>"; }
  function buTags(r) {
    var bu = r.bu || {}, keys = Object.keys(bu).sort(function (a, b) { return bu[b] - bu[a]; });
    return keys.map(function (k) { return '<span class="butag ' + (bu[k] === 3 ? "s" : "c") + '" title="' + esc(BU[k] || k) + ": " + (bu[k] === 3 ? "Super Active" : "Core Active") + '">' + esc(k) + "</span>"; }).join("");
  }
  function accountURL(r) { return "account.html?sec=" + SEC + "&key=" + encodeURIComponent(KEY) + "&pid=" + encodeURIComponent(r.pid) + "&metric=" + encodeURIComponent(current.key); }
  function columns() {
    var cols = [{ key: "name", label: "Practice", get: function (r) { return r.name; }, html: function (r) { return '<a href="' + esc(accountURL(r)) + '">' + esc(r.name) + "</a>"; }, cls: "pname" }];
    (current.cols || []).forEach(function (c, i) {
      cols.push(c[2] ? { key: "ctx" + i, label: c[0], get: c[1], num: true } : { key: "ctx" + i, label: c[0], get: function (r) { return +c[1](r); }, html: function (r) { return stateChip(c[1](r)); } });
    });
    cols.push({ key: "st", label: "Today", get: function (r) { return st(r) * 10 + Object.keys(r.bu || {}).length; }, html: function (r) { return stateChip(r.st) + buTags(r); }, cls: "wrap" });
    cols.push({ key: "mtd", label: monthLabel(lastIdx()) + " cases", get: lastMonth, num: true });
    cols.push({ key: "ytd", label: "Cases YTD", get: function (r) { return r.ytd; }, num: true });
    return cols;
  }
  function matches(r) { if (!query) return true; return (r.pid + " " + r.name + " " + (r.acc || []).join(" ")).toLowerCase().indexOf(query) >= 0; }
  function selected() {
    var rows = S.rows.filter(current.filter).filter(matches), cols = columns(), col = cols.filter(function (c) { return c.key === sortKey; })[0];
    if (current.sort && sortKey === "ytd" && sortDir === -1 && !query) rows.sort(current.sort);
    else if (col) rows.sort(function (a, b) { var x = col.get(a), y = col.get(b); if (x == null) x = ""; if (y == null) y = ""; return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    return rows;
  }
  function renderTable() {
    var rows = selected(), shown = showAll ? rows : rows.slice(0, 300), cols = columns();
    byId("dt-lead").innerHTML = '<div class="lead-n">' + fmtN(rows.length) + '</div><div class="lead-t">' + esc(current.title) + (SEC === "ae" && current.key === "total" ? ' <span class="dt-note">(the network is ' + fmtN(S.network) + ")</span>" : "") + "</div>";
    byId("dt-count").innerHTML = rows.length > shown.length ? 'Showing the first ' + fmtN(shown.length) + '. <button type="button" class="linkbtn" id="dt-more">Show all ' + fmtN(rows.length) + "</button>" : "";
    var head = "<tr>" + cols.map(function (c) { return '<th class="' + (c.num ? "r" : "") + ' sortable' + (sortKey === c.key ? " sorted" : "") + '" data-col="' + c.key + '">' + esc(c.label) + (sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : "") + "</th>"; }).join("") + "</tr>";
    var body = shown.map(function (r) {
      return '<tr class="rowlink" data-href="' + esc(accountURL(r)) + '" title="Open this practice">' + cols.map(function (c) { return '<td class="' + (c.num ? "r" : "") + (c.cls ? " " + c.cls : "") + '">' + (c.html ? c.html(r) : esc(c.get(r))) + "</td>"; }).join("") + "</tr>";
    }).join("") || '<tr><td colspan="' + cols.length + '" class="ph">No practices on this list.</td></tr>';
    byId("dt-table").innerHTML = "<thead>" + head + "</thead><tbody>" + body + "</tbody>";
    var more = byId("dt-more");
    if (more) more.addEventListener("click", function () { showAll = true; renderTable(); });
  }
  byId("dt-table").addEventListener("click", function (ev) {
    var tr = ev.target.closest ? ev.target.closest("tr.rowlink") : null;
    if (tr && !(ev.target.closest && ev.target.closest("a"))) { location.href = tr.getAttribute("data-href"); return; }
    var th = ev.target.closest ? ev.target.closest("th.sortable") : null;
    if (!th) return;
    var k = th.getAttribute("data-col");
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "name" ? 1 : -1; }
    renderTable();
  });
  byId("dt-search").addEventListener("input", function (ev) { query = ev.target.value.trim().toLowerCase(); showAll = false; renderTable(); });

  /* ---------- export: a csv that opens straight in Excel ---------- */
  byId("dt-export").addEventListener("click", function () {
    var rows = selected(), ctx = current.cols || [];
    var head = ["Practice ID", "Practice", "Accounts", "State today", "Business units at the bar"].concat(ctx.map(function (c) { return c[0]; }))
      .concat(["State 30 days ago", "State at start of " + quarter]).concat(months.map(function (m) { return "State end of " + m; })).concat(months.map(function (m) { return "Cases " + m; }))
      .concat(["Cases YTD", "Cases last 90 days", "First case", "Last case"]);
    function cell(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [head.map(cell).join(",")];
    rows.forEach(function (r) {
      var vals = [r.pid, r.name, (r.acc || []).join("; "), code(r.st), Object.keys(r.bu || {}).map(function (k) { return (BU[k] || k) + " " + (r.bu[k] === 3 ? "Super" : "Core"); }).join("; ")]
        .concat(ctx.map(function (c) { var v = c[1](r); return c[2] ? v : code(v); }))
        .concat([code(r.l30), code(r.q0)]).concat((r.hist || "").split("").map(code)).concat(r.cm || []).concat([r.ytd, r.c90, r.first || "", r.last || ""]);
      lines.push(vals.map(cell).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (S.title + " - " + current.title + " - " + (D.meta.data_through || "")).replace(/[\\/:*?"<>|]/g, " ").slice(0, 120) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  select(METRIC);
})();
