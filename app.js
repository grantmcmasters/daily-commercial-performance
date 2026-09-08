/* Daily Commercial Performance: page renderer and slide export.
   Data comes from data.js (window.DCP_DATA), rebuilt nightly by pipeline/build.py. */
(function () {
  "use strict";
  var D = window.DCP_DATA || { meta: {}, sections: {} };
  var byId = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtN(n) { return (n == null) ? "--" : Number(n).toLocaleString("en-US"); }
  function fmtPct(p) { return (p == null) ? "--" : Math.round(p).toLocaleString("en-US") + "%"; }
  function fmt1(n) { return (n == null) ? "--" : (Math.round(Number(n) * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function fmtMoney(v) {
    if (v == null) return "--";
    var a = Math.abs(v);
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return "$" + Math.round(v / 1e3) + "k";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "k";
    return "$" + Math.round(v);
  }
  function longDate(iso) {
    try {
      var p = iso.split("-");
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(+p[0], +p[1] - 1, +p[2]));
    } catch (e) { return iso; }
  }
  function signed(v) { return v > 0 ? "+" + v : String(v); }

  /* ---------- as-of pill (data through yesterday, refreshed at the run time in Pacific) ---------- */
  (function () {
    var m = D.meta || {};
    if (!m.run_date) { byId("asof").textContent = "Awaiting first data refresh"; return; }
    var label = "Data through " + longDate(m.data_through || m.run_date);
    try {
      if (m.run_ts) {
        var ts = new Date(m.run_ts);
        if (!isNaN(ts.getTime())) {
          label += " · refreshed " + new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(ts);
        }
      }
    } catch (e) { /* keep the shorter label */ }
    byId("asof").textContent = label;
  })();

  /* ---------- shared chart helpers ---------- */
  var NET_STROKE = "#6C7A88";
  var GREEN = "#34C759", RED = "#EF4444", GREEN_INK = "#1D7A3A", RED_INK = "#B0362F";
  var GREEN2 = "#15602B", RED2 = "#7A1414";           /* darker segments: Core to Super Active, Dabbler to inactive */
  var LINE_COLORS = ["#1882C7", "#4ABEEE", "#8A93A3", "#052030"];
  var CASES_COLOR = "#B3A369", CASES_INK = "#8A7A42";
  var NEW_COLOR = "#1882C7", QUIET_COLOR = "#D9534F";

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
  function grid(s, ticks, y, padL, W, padR, fmt, fs) {
    ticks.forEach(function (t) {
      var yy = y(t);
      s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#DDE2E9" stroke-width="1"/>');
      s.push('<text x="' + (padL - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="' + (fs || 10.5) + '" font-weight="700" fill="#5A6B79">' + (fmt ? fmt(t) : fmtN(t)) + '</text>');
    });
  }
  function tile(value, label, sub, tone) {
    return '<div class="b3t ' + (tone || "") + '"><div class="n">' + esc(value) + '</div><div class="t">' + esc(label) + '</div>' + (sub ? '<div class="rv">' + esc(sub) + "</div>" : "") + "</div>";
  }
  function tileHTML(value, label, subHTML, tone) {
    return '<div class="b3t ' + (tone || "") + '"><div class="n">' + esc(value) + '</div><div class="t">' + esc(label) + '</div><div class="rv">' + subHTML + "</div></div>";
  }
  function logoImg(path, title, small) {
    var cls = "sub-logo" + (small ? " sm" : "") + (/aspen-beacon/.test(path) ? " tall" : "");
    return '<img class="' + cls + '" src="' + esc(path) + '" alt="' + esc(title) + ' logo" onerror="this.style.display=\'none\'">';
  }

  /* ============================================================
     Charts (hand drawn SVG; W and H are the viewBox, so the same chart can be
     drawn with a different aspect for a slide)
     ============================================================ */
  var SERIES = [
    { key: "active", label: "Active (core + super)", color: "#1882C7", ink: "#FFFFFF" },
    { key: "dabbler", label: "Dabbler", color: "#4ABEEE", ink: "#052030" },
    { key: "new", label: "New", color: "#B3A369", ink: "#052030" }
  ];

  /* stacked submitters by month; when a network total is given the rest of the network is the dashed top level of the bar */
  function chartSVG(months, network, W, H) {
    W = W || 960; H = H || 360;
    var padL = 46, padR = 12, padT = 34, padB = 30;
    var n = months.length || 1;
    var max = network || 0;
    months.forEach(function (m) { if (m.total > max) max = m.total; });
    var ticks = niceTicks(max), ymax = ticks[ticks.length - 1] || 1;
    var iw = W - padL - padR, ih = H - padT - padB, slot = iw / n, bw = Math.min(64, slot * 0.56);
    var y = function (v) { return padT + ih - (v / ymax) * ih; };
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Submitting practices by month">'];
    grid(s, ticks, y, padL, W, padR);
    months.forEach(function (m, i) {
      var cx = padL + slot * i + slot / 2, x = cx - bw / 2, base = 0;
      SERIES.forEach(function (ser) {
        var v = m[ser.key] || 0;
        if (v <= 0) return;
        var y1 = y(base + v), h = y(base) - y1;
        s.push('<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + ser.color + '"/>');
        if (h >= 15) s.push('<text x="' + cx.toFixed(1) + '" y="' + (y1 + h / 2 + 4).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + ser.ink + '">' + v + '</text>');
        base += v;
      });
      var yt = y(base), roomAbove = 0;
      if (network && network > base) {
        var yn = y(network);
        roomAbove = yt - yn;
        s.push('<rect x="' + x.toFixed(1) + '" y="' + yn.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + roomAbove.toFixed(1) + '" fill="none" stroke="' + NET_STROKE + '" stroke-width="1.4" stroke-dasharray="5,4"/>');
        s.push('<text x="' + cx.toFixed(1) + '" y="' + (yn - 6).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#6C7A88">' + fmtN(network) + '</text>');
      }
      if (m.total > 0) {
        s.push((!network || roomAbove >= 20)
          ? '<text x="' + cx.toFixed(1) + '" y="' + (yt - 6).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="800" fill="#052030">' + fmtN(m.total) + '</text>'
          : '<text x="' + cx.toFixed(1) + '" y="' + (yt + 14).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="800" fill="#FFFFFF">' + fmtN(m.total) + '</text>');
      }
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="#5A6B79">' + esc(m.label) + '</text>');
    });
    s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#B0B7C3" stroke-width="1"/>');
    return s.join("") + "</svg>";
  }

  /* weekly average cases per business day: one figure per Monday-to-Friday week in the window */
  function weeklyAverages(days) {
    var weeks = [], cur = null;
    days.forEach(function (d, i) {
      if (!cur || d.monday) { cur = { idx: [], sum: 0 }; weeks.push(cur); }
      cur.idx.push(i); cur.sum += d.n;
    });
    var perDay = new Array(days.length);
    weeks.forEach(function (w) {
      w.avg = w.sum / w.idx.length;
      w.idx.forEach(function (i) { perDay[i] = w.avg; });
    });
    return { weeks: weeks, perDay: perDay };
  }

  /* case volume by business day with the weekly average as a straight dashed gold line through one point per week */
  function dailySVG(days, W, H) {
    W = W || 1200; H = H || 400;
    var padL = 44, padR = 12, padT = 34, padB = 36;
    var n = days.length || 1, max = 0;
    days.forEach(function (d) { if (d.n > max) max = d.n; });
    var ticks = niceTicks(max), ymax = ticks[ticks.length - 1] || 1;
    var iw = W - padL - padR, ih = H - padT - padB, slot = iw / n, bw = slot * 0.7;
    var y = function (v) { return padT + ih - (v / ymax) * ih; };
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Case volume by business day, trailing 60 days, with the weekly average per business day">'];
    grid(s, ticks, y, padL, W, padR, null, 11);
    days.forEach(function (d, i) {
      var cx = padL + slot * i + slot / 2, x = cx - bw / 2, y1 = y(d.n), h = y(0) - y1;
      s.push('<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (d.monday ? "#0F6BA8" : "#1882C7") + '" fill-opacity="' + (d.monday ? "1" : "0.62") + '" rx="1.5"/>');
      if (d.n > 0) {
        s.push(h >= 16
          ? '<text x="' + cx.toFixed(1) + '" y="' + (y(0) - 5).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="800" fill="#FFFFFF" paint-order="stroke" stroke="#0F6BA8" stroke-width="1.2">' + d.n + '</text>'
          : '<text x="' + cx.toFixed(1) + '" y="' + (y1 - 4).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="800" fill="#052030">' + d.n + '</text>');
      }
      if (d.monday) s.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11.5" font-weight="800" fill="#0F6BA8">' + esc(d.label) + '</text>');
    });
    var wa = weeklyAverages(days), pts = [], pills = [];
    wa.weeks.forEach(function (w) {
      var cx = padL + slot * (w.idx[0] + w.idx[w.idx.length - 1] + 1) / 2;
      var ya = y(w.avg), label = fmt1(w.avg), pw = label.length * 8.8 + 14, py = ya - 29;
      pts.push(cx.toFixed(1) + "," + ya.toFixed(1));
      pills.push({ cx: cx, ya: ya, py: py, pw: pw, label: label });
    });
    if (pts.length) s.push('<polyline points="' + pts.join(" ") + '" fill="none" stroke="#B3A369" stroke-width="3.5" stroke-dasharray="8,5" stroke-linecap="round" stroke-linejoin="round"/>');
    pills.forEach(function (p) {
      s.push('<circle cx="' + p.cx.toFixed(1) + '" cy="' + p.ya.toFixed(1) + '" r="4.5" fill="#B3A369" stroke="#FFFFFF" stroke-width="1.5"/>');
      s.push('<rect x="' + (p.cx - p.pw / 2).toFixed(1) + '" y="' + p.py.toFixed(1) + '" width="' + p.pw.toFixed(1) + '" height="20" rx="5" fill="#B3A369"/>');
      s.push('<text x="' + p.cx.toFixed(1) + '" y="' + (p.py + 14.5).toFixed(1) + '" text-anchor="middle" font-size="13.5" font-weight="800" fill="#052030">' + p.label + '</text>');
    });
    s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#B0B7C3" stroke-width="1"/>');
    return s.join("") + "</svg>";
  }

  /* one plot: the revenue axis is auto-fit (it starts near the lowest revenue point, not at $0) and the
     cases bars are scaled so the tallest one stays just under the lowest revenue point */
  function lineSVG(rev, W, H) {
    W = W || 560; H = H || 380;
    var padL = 48, padR = 44, padT = 24, padB = 30;
    var months = rev.months, n = months.length || 1, max = 0, min = Infinity, last = n - 1, proj = rev.mtd_factor != null;
    rev.series.forEach(function (ser) {
      ser.values.forEach(function (v, i) { var vv = (proj && i === last && ser.projected_last != null) ? ser.projected_last : v; if (vv != null) { if (vv > max) max = vv; if (vv < min) min = vv; } });
    });
    if (!isFinite(min)) min = 0;
    var iw = W - padL - padR, ih = H - padT - padB, slot = iw / n;
    var cpo = rev.cases_per_office || [], cmax = 0;
    cpo.forEach(function (v, i) { var vv = (proj && i === last && rev.cases_projected_last != null) ? rev.cases_projected_last : v; if (vv != null && vv > cmax) cmax = vv; });
    var cticks = niceTicks(cmax), cymax = cticks[cticks.length - 1] || 1;
    var span = Math.max(max - min, max * 0.15, 1), step = niceTicks(span)[1] || 1, lo = Math.max(0, Math.floor((min - span * 0.25) / step) * step), hi = Math.ceil((max + step * 0.5) / step) * step;
    var y, gap = 18, bandTop, bandH, tries = 0;
    do {
      if (hi <= lo) hi = lo + step;
      y = (function (lo_, hi_) { return function (v) { return padT + ih - ((v - lo_) / (hi_ - lo_)) * ih; }; })(lo, hi);
      bandTop = y(min) + gap;
      bandH = padT + ih - bandTop;
      if (bandH < ih * 0.28 && lo > 0) lo = Math.max(0, lo - step); else break;
    } while (++tries < 12);
    var x = function (i) { return padL + slot * i + slot / 2; };
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Invoiced revenue per invoiced practice (line) with cases invoiced per invoiced practice (bars) by month">'];
    for (var t = lo; t <= hi + 1e-9; t += step) {
      var yy = y(t);
      s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#DDE2E9" stroke-width="1"/>');
      s.push('<text x="' + (padL - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="#5A6B79">' + fmtMoney(t) + '</text>');
    }
    var y2 = function (v) { return padT + ih - (v / cymax) * bandH; };
    [0, cymax].forEach(function (t) { s.push('<text x="' + (W - padR + 8) + '" y="' + (y2(t) + 3.5).toFixed(1) + '" text-anchor="start" font-size="10.5" font-weight="700" fill="' + CASES_INK + '">' + fmtN(t) + '</text>'); });
    var bw = Math.min(30, slot * 0.5);
    cpo.forEach(function (v, i) {
      var est = proj && i === last && rev.cases_projected_last != null;
      var vv = est ? rev.cases_projected_last : v;
      if (vv == null) return;
      var cx = x(i), y1 = y2(vv), h = y2(0) - y1;
      s.push(est
        ? '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="none" stroke="' + CASES_COLOR + '" stroke-width="2" stroke-dasharray="5,4" rx="2"/>'
        : '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + CASES_COLOR + '" rx="2"/>');
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (y1 - 5).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="800" fill="' + CASES_INK + '">' + vv + (est ? " est" : "") + '</text>');
    });
    s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y2(0).toFixed(1) + '" y2="' + y2(0).toFixed(1) + '" stroke="#B0B7C3" stroke-width="1"/>');
    rev.series.forEach(function (ser, si) {
      var col = LINE_COLORS[si % LINE_COLORS.length], pts = [];
      ser.values.forEach(function (v, i) {
        var est = proj && i === last && ser.projected_last != null;
        var vv = est ? ser.projected_last : v;
        if (vv != null) pts.push([x(i), y(vv), vv, i, est]);
      });
      var solid = pts.filter(function (p) { return !p[4]; }), est = pts.filter(function (p) { return p[4]; })[0];
      if (solid.length > 1) s.push('<polyline fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" points="' + solid.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>');
      if (est && solid.length) {
        var a = solid[solid.length - 1];
        s.push('<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + est[0].toFixed(1) + '" y2="' + est[1].toFixed(1) + '" stroke="' + col + '" stroke-width="2.5" stroke-dasharray="7,5" stroke-linecap="round"/>');
      }
      pts.forEach(function (p) {
        s.push(p[4]
          ? '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="#FFFFFF" stroke="' + col + '" stroke-width="2.5"/>'
          : '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="' + col + '" stroke="#FFFFFF" stroke-width="1.5"/>');
        s.push('<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 8).toFixed(1) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="' + col + '">' + fmtMoney(p[2]) + (p[4] ? " est" : "") + '</text>');
      });
    });
    months.forEach(function (m, i) { s.push('<text x="' + x(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#5A6B79">' + esc(m) + '</text>'); });
    return s.join("") + "</svg>";
  }

  /* diverging stacked bars: up to active (green) with Core to Super Active on top (dark green) above the axis;
     down from active (red) with Dabbler to inactive beneath (dark red) below; net of all four under each week */
  var WOW_LEGEND = [
    { label: "Dabbler → Active", color: GREEN }, { label: "Active → Super Active", color: GREEN2 },
    { label: "Active → Dabbler", color: RED }, { label: "Dabbler → Inactive", color: RED2 }
  ];
  function wowSVG(weekly, W, H) {
    W = W || 560; H = H || 330;
    var weeks = weekly.weeks, padL = 36, padR = 10, padT = 24, padB = 54;
    var n = weeks.length || 1, top = 1;
    weeks.forEach(function (w) { top = Math.max(top, w.promoted + (w.up_super || 0), w.demoted + (w.down_quiet || 0)); });
    var ticks = niceTicks(top), m = ticks[ticks.length - 1] || 1;
    var iw = W - padL - padR, ih = H - padT - padB, slot = iw / n, bw = Math.min(34, slot * 0.62), half = ih / 2;
    var y = function (v) { return padT + half - (v / m) * half; };
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Week over week: moves up above the axis, moves down below, net per week">'];
    ticks.forEach(function (t) {
      [t, -t].forEach(function (v) {
        var yy = y(v);
        s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#DDE2E9" stroke-width="1"/>');
        s.push('<text x="' + (padL - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="#5A6B79">' + (v < 0 ? "-" + fmtN(-v) : fmtN(v)) + '</text>');
      });
    });
    function seg(x, a, b, color, cx) {
      var y1 = Math.min(y(a), y(b)), h = Math.abs(y(a) - y(b));
      s.push('<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + color + '"/>');
      if (h >= 14) s.push('<text x="' + cx.toFixed(1) + '" y="' + (y1 + h / 2 + 3.5).toFixed(1) + '" text-anchor="middle" font-size="9.5" font-weight="800" fill="#FFFFFF">' + Math.abs(b - a) + '</text>');
    }
    weeks.forEach(function (w, i) {
      var cx = padL + slot * i + slot / 2, x = cx - bw / 2;
      var up = w.promoted, up2 = w.up_super || 0, dn = w.demoted, dn2 = w.down_quiet || 0;
      if (up > 0) seg(x, 0, up, GREEN, cx);
      if (up2 > 0) seg(x, up, up + up2, GREEN2, cx);
      if (up + up2 > 0) s.push('<text x="' + cx.toFixed(1) + '" y="' + (y(up + up2) - 5).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="800" fill="' + GREEN_INK + '">+' + (up + up2) + '</text>');
      if (dn > 0) seg(x, 0, -dn, RED, cx);
      if (dn2 > 0) seg(x, -dn, -dn - dn2, RED2, cx);
      if (dn + dn2 > 0) s.push('<text x="' + cx.toFixed(1) + '" y="' + (y(-dn - dn2) + 13).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="800" fill="' + RED_INK + '">-' + (dn + dn2) + '</text>');
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 32) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#5A6B79">' + esc(w.label) + (w.partial ? "*" : "") + '</text>');
      var netCol = w.net > 0 ? GREEN_INK : w.net < 0 ? RED_INK : "#5A6B79";
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="14" font-weight="800" fill="' + netCol + '">' + signed(w.net) + '</text>');
    });
    s.push('<text x="' + (padL - 6) + '" y="' + (H - 12) + '" text-anchor="end" font-size="9.5" font-weight="800" fill="#5A6B79">NET</text>');
    s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#052030" stroke-width="1.5"/>');
    return s.join("") + "</svg>";
  }

  /* retention: where the practices that were active at the start of the quarter sit today (flow, top) and
     the same practices' invoiced revenue this quarter against the quarter before (bars, bottom) */
  function retentionSVG(ret, W, H) {
    W = W || 640; H = H || 400;
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Retention: practices active at the start of the quarter and where they are now; cohort revenue this quarter against last quarter">'];
    var q = ret.quarter, pq = ret.prev_quarter, n = ret.start_active || 0, total = Math.max(n, 1);
    var left = 12, right = W - 12, top = 10, flowTop = top + 40, flowH = Math.round(H * 0.56) - flowTop, y0 = flowTop, avail = flowH;
    s.push('<text x="' + left + '" y="' + (top + 11) + '" font-size="11" font-weight="800" fill="#052030" letter-spacing="1">ACTIVE PRACTICES AT THE START OF ' + esc(q).toUpperCase() + '</text>');
    s.push('<text x="' + left + '" y="' + (top + 28) + '" font-size="11" font-weight="700" fill="#5A6B79">Where those ' + n + ' practices sit today</text>');
    var barX = left + 6, barW = 30, nodeX = Math.round(W * 0.56), nodeW = 26, mid = (barX + barW + nodeX) / 2;
    s.push('<rect x="' + barX + '" y="' + y0 + '" width="' + barW + '" height="' + avail.toFixed(1) + '" fill="#1882C7" rx="3"/>');
    s.push('<text x="' + (barX + barW / 2).toFixed(1) + '" y="' + (y0 + avail / 2 + 7).toFixed(1) + '" text-anchor="middle" font-size="20" font-weight="800" fill="#FFFFFF">' + n + '</text>');
    s.push('<text x="' + (barX + barW + 8) + '" y="' + (y0 + 12) + '" font-size="10" font-weight="700" fill="#0F6BA8">Active, ' + esc(shortStart(ret.start)) + '</text>');
    var parts = [["stayed", "Still active", GREEN, GREEN_INK], ["to_dabbler", "Now dabbler", "#4ABEEE", "#0F6BA8"], ["to_inactive", "Now inactive", RED, RED_INK]];
    var gap = 8, live = parts.filter(function (p) { return (ret[p[0]] || 0) > 0; }).length, usable = avail - gap * Math.max(live - 1, 0);
    var yR = y0, yL = y0, lastLabel = -1e9;
    parts.forEach(function (p) {
      var v = ret[p[0]] || 0;
      if (v <= 0) return;
      var hR = usable * v / total, hL = avail * v / total;
      s.push('<path d="M' + (barX + barW) + ',' + yL.toFixed(1) + ' C' + mid.toFixed(1) + ',' + yL.toFixed(1) + ' ' + mid.toFixed(1) + ',' + yR.toFixed(1) + ' ' + nodeX + ',' + yR.toFixed(1) +
        ' L' + nodeX + ',' + (yR + hR).toFixed(1) + ' C' + mid.toFixed(1) + ',' + (yR + hR).toFixed(1) + ' ' + mid.toFixed(1) + ',' + (yL + hL).toFixed(1) + ' ' + (barX + barW) + ',' + (yL + hL).toFixed(1) + ' Z" fill="' + p[2] + '" fill-opacity="0.32"/>');
      s.push('<rect x="' + nodeX + '" y="' + yR.toFixed(1) + '" width="' + nodeW + '" height="' + Math.max(hR, 3).toFixed(1) + '" fill="' + p[2] + '" rx="2"/>');
      var ly = Math.max(yR + hR / 2 + 4, lastLabel + 15);
      s.push('<text x="' + (nodeX + nodeW + 8) + '" y="' + ly.toFixed(1) + '" font-size="12" font-weight="800" fill="' + p[3] + '">' + v + '<tspan font-size="10.5" font-weight="700" fill="#5A6B79"> ' + p[1] + ' (' + Math.round(100 * v / total) + '%)</tspan></text>');
      lastLabel = ly;
      yR += hR + gap; yL += hL;
    });
    if (n === 0) s.push('<text x="' + (nodeX + nodeW + 8) + '" y="' + (y0 + avail / 2 + 4) + '" font-size="11" font-weight="700" fill="#5A6B79">No active practices at the start of the quarter</text>');
    var footY = y0 + avail + 16;
    s.push('<text x="' + left + '" y="' + footY + '" font-size="10.5" font-weight="700" fill="#5A6B79">Active today: <tspan font-weight="800" fill="#052030">' + fmtN(ret.active_now) + '</tspan> = ' + fmtN(ret.stayed) + ' still active + ' + fmtN(ret.joined) + ' newly active since ' + esc(shortStart(ret.start)) + '</text>');
    /* revenue retention */
    var rv = ret.revenue || {}, ry = footY + 24;
    s.push('<line x1="' + left + '" x2="' + right + '" y1="' + (ry - 10) + '" y2="' + (ry - 10) + '" stroke="#DDE2E9" stroke-width="1"/>');
    s.push('<text x="' + left + '" y="' + (ry + 4) + '" font-size="11" font-weight="800" fill="#052030" letter-spacing="1">REVENUE FROM THOSE PRACTICES, ' + esc(pq).toUpperCase() + ' VS ' + esc(q).toUpperCase() + '</text>');
    var labelW = 84, bx0 = left + labelW, bx1 = right - 210, full = bx1 - bx0, bh = 20, r1 = ry + 16, r2 = r1 + bh + 10;
    var base = rv.base || 0, qtd = rv.qtd || 0, rr = rv.run_rate == null ? null : rv.run_rate;
    var scaleMax = Math.max(base, qtd, rr || 0, 1), wOf = function (v) { return full * v / scaleMax; };
    s.push('<text x="' + (bx0 - 8) + '" y="' + (r1 + 14) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="#5A6B79">' + esc(pq.split(" ")[0]) + ' invoiced</text>');
    s.push('<rect x="' + bx0 + '" y="' + r1 + '" width="' + Math.max(wOf(base), 1).toFixed(1) + '" height="' + bh + '" fill="#8A93A3" rx="3"/>');
    s.push('<text x="' + (bx0 + wOf(base) + 7).toFixed(1) + '" y="' + (r1 + 14) + '" font-size="11" font-weight="800" fill="#052030">' + fmtMoney(base) + '</text>');
    s.push('<text x="' + (bx0 - 8) + '" y="' + (r2 + 14) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="#5A6B79">' + esc(q.split(" ")[0]) + ' to date</text>');
    s.push('<rect x="' + bx0 + '" y="' + r2 + '" width="' + Math.max(wOf(qtd), 1).toFixed(1) + '" height="' + bh + '" fill="#1882C7" rx="3"/>');
    if (rr != null && rr > qtd) s.push('<rect x="' + (bx0 + wOf(qtd)).toFixed(1) + '" y="' + (r2 + 1) + '" width="' + (wOf(rr) - wOf(qtd)).toFixed(1) + '" height="' + (bh - 2) + '" fill="none" stroke="#1882C7" stroke-width="1.6" stroke-dasharray="5,4" rx="3"/>');
    var endX = bx0 + wOf(Math.max(qtd, rr || 0)) + 7;
    s.push('<text x="' + endX.toFixed(1) + '" y="' + (r2 + 14) + '" font-size="11" font-weight="800" fill="#0F6BA8">' + fmtMoney(qtd) + (rr != null ? '<tspan font-weight="700" fill="#5A6B79"> QTD, ' + fmtMoney(rr) + ' at run rate</tspan>' : "") + '</text>');
    var pctY = r2 + bh + 26;
    if (rv.pct_run_rate != null) {
      var pr = Math.round(rv.pct_run_rate), col = pr >= 100 ? GREEN_INK : pr >= 85 ? "#8A7A42" : RED_INK;
      s.push('<text x="' + left + '" y="' + pctY + '" font-size="20" font-weight="800" fill="' + col + '">' + pr + '%<tspan font-size="11" font-weight="700" fill="#5A6B79"> revenue retention at run rate</tspan><tspan font-size="10.5" font-weight="700" fill="#8A93A3">  (' + Math.round(rv.pct_qtd) + '% so far, ' + rv.biz_elapsed + ' of ' + rv.biz_total + ' business days)</tspan></text>');
    } else {
      s.push('<text x="' + left + '" y="' + pctY + '" font-size="11" font-weight="700" fill="#5A6B79">No ' + esc(pq) + ' invoiced revenue from these practices to compare against</text>');
    }
    return s.join("") + "</svg>";
  }
  function shortStart(iso) {
    try { var p = iso.split("-"); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(+p[0], +p[1] - 1, +p[2])); } catch (e) { return iso; }
  }

  /* programs: new submitters (blue) beside practices that went quiet (red) each month */
  function newQuietSVG(months, W, H) {
    W = W || 960; H = H || 300;
    var padL = 40, padR = 12, padT = 26, padB = 30;
    var n = months.length || 1, max = 0;
    months.forEach(function (m) { max = Math.max(max, m.new || 0, m.gone_quiet || 0); });
    var ticks = niceTicks(max), ymax = ticks[ticks.length - 1] || 1;
    var iw = W - padL - padR, ih = H - padT - padB, slot = iw / n, bw = Math.min(34, slot * 0.3), gapb = 4;
    var y = function (v) { return padT + ih - (v / ymax) * ih; };
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="New submitting practices and practices gone quiet, by month">'];
    grid(s, ticks, y, padL, W, padR);
    months.forEach(function (m, i) {
      var cx = padL + slot * i + slot / 2;
      [[m.new || 0, NEW_COLOR, cx - bw - gapb / 2], [m.gone_quiet || 0, QUIET_COLOR, cx + gapb / 2]].forEach(function (b) {
        var y1 = y(b[0]), h = y(0) - y1;
        s.push('<rect x="' + b[2].toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + b[1] + '" rx="2"/>');
        s.push('<text x="' + (b[2] + bw / 2).toFixed(1) + '" y="' + (y1 - 6).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="800" fill="#052030">' + fmtN(b[0]) + '</text>');
      });
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="#5A6B79">' + esc(m.label) + '</text>');
    });
    s.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#B0B7C3" stroke-width="1"/>');
    return s.join("") + "</svg>";
  }

  /* ============================================================
     State table (month or week, current year or quarter) with its picker
     ============================================================ */
  var STATE_TABLES = {};
  function deltaStyle(tone, d) {
    if (d == null || d === 0) return "background:rgba(176,183,195,.12);color:#5A6B79";
    if (tone === "neutral") return "background:rgba(176,183,195,.26);color:#5A6B79";
    var good = tone === "good_up" ? d > 0 : d < 0, mag = Math.min(1, Math.abs(d) / 6);
    return good ? "background:rgba(52,199,89," + (0.16 + 0.5 * mag).toFixed(2) + ");color:#1D7A3A"
                : "background:rgba(239,68,68," + (0.12 + 0.46 * mag).toFixed(2) + ");color:#B0362F";
  }
  function statesTableHTML(t) {
    var h = '<table class="mx' + (t.columns.length > 14 ? " dense" : "") + '"><thead><tr><th>State at ' + esc(t.kind) + ' end</th>' + t.columns.map(function (c) { return "<th>" + esc(c.label) + (c.partial ? "*" : "") + "</th>"; }).join("") + "</tr></thead><tbody>";
    t.rows.forEach(function (r) {
      h += '<tr><td class="lbl">' + esc(r.label) + "</td>";
      r.values.forEach(function (v, i) {
        var d = r.deltas[i];
        h += '<td style="' + deltaStyle(r.tone, d) + '">' + fmtN(v) + (d == null || d === 0 ? "" : '<small style="display:block;font-size:9.5px;font-weight:700">' + signed(d) + "</small>") + "</td>";
      });
      h += "</tr>";
    });
    return h + "</tbody></table>";
  }
  function statesTitle(t) { return (t.kind === "month" ? "Month over month, " : "Week over week, ") + t.range_label; }
  function statesPanel(id, states) {
    STATE_TABLES[id] = states;
    var key = states["default"] || "year_month", t = states[key], parts = key.split("_");
    return '<div class="panel states" data-states="' + esc(id) + '"><div class="chart-head"><div class="panel-title" data-role="title">' + esc(statesTitle(t)) + '</div>' +
      '<div class="seg-row"><div class="seg" data-dim="kind">' +
        '<button type="button" data-v="month" class="' + (parts[1] === "month" ? "on" : "") + '">Month</button><button type="button" data-v="week" class="' + (parts[1] === "week" ? "on" : "") + '">Week</button></div>' +
      '<div class="seg" data-dim="range">' +
        '<button type="button" data-v="year" class="' + (parts[0] === "year" ? "on" : "") + '">Year</button><button type="button" data-v="quarter" class="' + (parts[0] === "quarter" ? "on" : "") + '">Quarter</button></div></div></div>' +
      '<div class="mx-wrap" data-role="host">' + statesTableHTML(t) + "</div></div>";
  }
  document.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest(".seg button") : null;
    if (!btn) return;
    var panel = btn.closest(".panel.states"), states = STATE_TABLES[panel.getAttribute("data-states")];
    if (!states) return;
    [].forEach.call(btn.parentNode.querySelectorAll("button"), function (b) { b.classList.toggle("on", b === btn); });
    var pick = {};
    [].forEach.call(panel.querySelectorAll(".seg"), function (seg) { var on = seg.querySelector("button.on"); pick[seg.getAttribute("data-dim")] = on ? on.getAttribute("data-v") : ""; });
    var t = states[pick.range + "_" + pick.kind];
    if (!t) return;
    panel.querySelector('[data-role="title"]').textContent = statesTitle(t);
    panel.querySelector('[data-role="host"]').innerHTML = statesTableHTML(t);
  });

  function legendHTML(items) {
    return items.map(function (it) { return '<span><i style="background:' + it.color + '"></i>' + esc(it.label) + "</span>"; }).join("");
  }
  function playsPanel(title, plays, extraClass) {
    return '<div class="panel' + (extraClass ? " " + extraClass : "") + '"><div class="panel-title">' + esc(title) + '</div><ul class="plays-list" contenteditable="true" spellcheck="false">' +
      (plays || []).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></div>";
  }

  /* ============================================================
     Account Executives (practice level)
     ============================================================ */
  var AE = (D.sections || {}).ae || null;
  function renderAE() {
    var host = byId("ae-subs");
    if (!AE || !AE.subsections || !AE.subsections.length) return;
    host.innerHTML = AE.subsections.map(function (sub) {
      var c = sub.cards;
      return '<div class="sub card" id="ae-' + esc(sub.key) + '" data-sub="' + esc(sub.key) + '">' +
        '<div class="sub-head"><div class="sub-brand">' + (sub.logo ? logoImg(sub.logo, sub.title) : "") +
          '<div class="sub-title">' + esc(sub.title) + "</div></div>" +
        '<div><span class="chip chip-b">' + esc(sub.ae) + "</span></div></div>" +
        '<div class="b5row">' +
          tile(fmtN(c.total), "Total practices", "", "") +
          tile(fmtN(c.active), "Active", "", "g") +
          tile(fmtN(c.dabblers), "Dabblers", "", "") +
          tile(fmtPct(c.penetration_pct), "YTD penetration", fmtN(c.ytd_submitters) + " / " + fmtN(c.total) + " practices submitted a case YTD", "d") +
          tile(fmtN(c.mtd_net_new), "MTD net new submitters", "", "g") +
        "</div>" +
        '<div class="chart-wrap"><div class="chart-head"><div class="panel-title">Submitting practices by month, ' + esc(AE.year) + ' YTD</div><div class="legend">' +
          legendHTML(SERIES) + '<span><i class="dash"></i>Rest of the network (' + fmtN(sub.network) + " total)</span></div></div>" + chartSVG(sub.months, sub.network) + "</div>" +
        '<div class="bottom">' + statesPanel("ae-" + sub.key, sub.states) + playsPanel("Plays", sub.plays) + "</div></div>";
    }).join("");
  }

  /* ============================================================
     Account Managers (practice level)
     ============================================================ */
  var AM = (D.sections || {}).am || null;
  function avgTickerHTML(c) {
    if (c.avg_pct == null) return '<span class="tick flat">n/a</span> no ' + esc(c.prior_month_label) + " cases to compare";
    var tone = c.avg_pct > 0.5 ? "up" : c.avg_pct < -0.5 ? "down" : "flat";
    return '<span class="tick ' + tone + '">' + (c.avg_pct > 0 ? "+" : "") + Math.round(c.avg_pct) + "%</span> from " + esc(c.prior_month_label) + " (" + fmtN(Math.round(c.avg_per_day_prior)) + " per day)";
  }
  function avgTickerText(c) {
    if (c.avg_pct == null) return "no " + c.prior_month_label + " cases to compare";
    return (c.avg_pct > 0 ? "+" : "") + Math.round(c.avg_pct) + "% from " + c.prior_month_label + " (" + fmtN(Math.round(c.avg_per_day_prior)) + " per day)";
  }
  function revenueLegend(sub) {
    return sub.revenue.series.map(function (ser, i) { return '<span><i class="ln" style="background:' + LINE_COLORS[i % LINE_COLORS.length] + '"></i>' + esc(ser.name === "All" ? "Revenue per invoiced practice" : ser.name + " revenue per practice") + "</span>"; }).join("") +
      '<span><i style="background:' + CASES_COLOR + '"></i>Cases per invoiced practice (bars, right axis)</span>' +
      (sub.revenue.mtd_factor != null ? '<span><i class="dash-gold" style="border-color:#5A6B79"></i>' + esc(sub.revenue.mtd_label) + " at run rate</span>" : "");
  }
  function renderAM() {
    var host = byId("am-subs");
    if (!AM || !AM.subsections || !AM.subsections.length) return;
    host.innerHTML = AM.subsections.map(function (sub) {
      var c = sub.cards, dly = sub.daily;
      return '<div class="sub card" id="am-' + esc(sub.key) + '" data-sub="' + esc(sub.key) + '">' +
        '<div class="sub-head"><div class="sub-brand"><div class="sub-logos"><div class="logo-cell">' + (sub.logos || []).map(function (p) { return logoImg(p, sub.label, sub.logos.length > 1); }).join("") +
          (sub.logo_tag ? '<span class="logo-tag">' + esc(sub.logo_tag) + "</span>" : "") + "</div></div>" +
          '<div class="sub-title">' + esc(sub.name) + "</div></div>" +
        '<div><span class="chip chip-b">' + esc(sub.label) + "</span></div></div>" +
        '<div class="b4row">' +
          tile(fmtN(c.submitters_ytd), "Submitters YTD", "", "g") +
          tileHTML(fmtN(Math.round(c.avg_per_day_mtd)), "Cases Booked per Day, " + c.month_label + "'" + String(AM.year).slice(-2), avgTickerHTML(c), "") +
          tile("+" + fmtN(c.promoted_30), "Became active L30D", "", "up") +
          tile("-" + fmtN(c.demoted_30), "Lost active status L30D", "", "dn") +
        "</div>" +
        '<div class="chart-wrap hero"><div class="chart-head"><div class="panel-title big">Case volume by business day, trailing 60 days (' + fmtN(dly.total) + ' cases)</div><div class="legend"><span><i style="background:#1882C7"></i>Cases received per day</span><span><i class="dash-gold"></i>Weekly average per business day</span></div></div>' + dailySVG(dly.days) + "</div>" +
        '<div class="am-grid3">' +
          '<div class="panel"><div class="chart-head"><div class="panel-title">Retention, ' + esc(sub.retention.quarter) + '</div></div>' + retentionSVG(sub.retention, 640, 400) + "</div>" +
          '<div class="panel"><div class="chart-head"><div class="panel-title">Revenue and case utilization, ' + esc(AM.year) + ' YTD</div><div class="legend">' + revenueLegend(sub) + "</div></div>" + lineSVG(sub.revenue, 640, 400) + "</div>" +
          '<div class="panel"><div class="chart-head"><div class="panel-title">Week over week, ' + esc(sub.weekly.quarter) + '</div><div class="legend">' + legendHTML(WOW_LEGEND) + "</div></div>" + wowSVG(sub.weekly, 640, 400) + "</div>" +
        "</div></div>";
    }).join("");
  }

  /* ============================================================
     Programs (practice level)
     ============================================================ */
  var PG = (D.sections || {}).programs || null;
  var PG_LEGEND = [{ label: "New submitters (first ever case that month)", color: NEW_COLOR }, { label: "Gone quiet (90+ days without a case)", color: QUIET_COLOR }];
  function renderPrograms() {
    var host = byId("pg-subs");
    if (!PG || !PG.subsections || !PG.subsections.length) return;
    host.innerHTML = PG.subsections.map(function (sub) {
      var c = sub.cards;
      return '<div class="sub card" id="pg-' + esc(sub.key) + '" data-sub="pg-' + esc(sub.key) + '">' +
        '<div class="sub-head"><div class="sub-brand">' + (sub.logo ? logoImg(sub.logo, sub.title) : "") +
          '<div class="sub-title">' + esc(sub.title) + "</div></div>" +
        '<div><span class="chip chip-b">Marketing</span></div></div>' +
        '<div class="pg-tiles">' +
          tile(fmtN(c.submitters_ytd), "Submitters YTD", "", "g") +
          '<div class="eq">=</div>' +
          '<div class="tile-group">' +
            tile(fmtN(c.active), "Active", "", "g") +
            tile(fmtN(c.dabblers), "Dabblers", "", "") +
            tile(fmtN(c.gone_quiet), "Gone quiet", "", "q") +
          "</div>" +
        "</div>" +
        '<div class="chart-wrap"><div class="chart-head"><div class="panel-title">New submitters and gone quiet by month, ' + esc(PG.year) + ' YTD</div><div class="legend">' + legendHTML(PG_LEGEND) + "</div></div>" + newQuietSVG(sub.months) + "</div>" +
        '<div class="bottom">' + statesPanel("pg-" + sub.key, sub.states) +
          '<div class="panel"><div class="chart-head"><div class="panel-title">Week over week, ' + esc(sub.weekly.quarter) + '</div><div class="legend">' + legendHTML(WOW_LEGEND) + "</div></div>" + wowSVG(sub.weekly) + "</div></div>" +
        playsPanel("Plays: initiatives and growth", sub.plays, "plays-wide") +
      "</div>";
    }).join("");
  }

  /* ============================================================
     About: every definition and footnote lives here
     ============================================================ */
  function aboutHTML() {
    var ae = (AE && AE.definition) || {}, am = (AM && AM.definition) || {}, pg = (PG && PG.definition) || {};
    var networks = ((AE && AE.subsections) || []).map(function (s) { return "<li><b>" + esc(s.title) + ":</b> " + esc(s.cards.total_note) + "</li>"; }).join("");
    return '<h3>What this page is</h3>' +
      "<p>One one pager per partner, per account manager and per program, all at the practice level (account numbers roll up to a practice id; Incisive renumbered accounts roll up to their legacy practice). Data runs through yesterday and is rebuilt every night at 3:30 AM Pacific from the company database; the banner shows the last day of data included and when the page was refreshed. No patient information appears anywhere. The Export slides button at the top builds a PDF deck with one slide per one pager plus this About page.</p>" +
      "<h3>Activity definitions</h3><ul>" +
      "<li><b>Super Active:</b> " + esc(ae.super_active) + ".</li><li><b>Core Active:</b> " + esc(ae.core_active) + ".</li><li><b>Active:</b> Core Active or Super Active.</li>" +
      "<li><b>Dabbler:</b> " + esc(ae.dabbler) + ".</li><li><b>Inactive (quiet):</b> no case in the last 90 days, including practices that have never sent one.</li><li><b>New:</b> " + esc(ae.new) + ".</li>" +
      "<li>A snapshot counts cases received in the 90 days before it, and the 90 days before that for the Super Active test, one business unit per case (the business unit comes from the primary product). Month columns are measured at the end of the month; the current month at yesterday.</li></ul>" +
      "<h3>State tables and the picker</h3><ul>" +
      "<li><b>Month over month / week over week:</b> where the practices sit at the end of each month or week (Super Active, Core Active, Dabbler, New, Inactive). The picker switches between months and weeks and between the current year and the current quarter; the default, month by month for the current year, is what the slides show.</li>" +
      "<li>Weeks are seven day blocks from the first day of the year or quarter, so the two weekly views use different week boundaries. * marks the partial period through yesterday. The small number and the color show the change from the period before: green is good, red is bad, gray is neutral (Dabbler) or no change.</li></ul>" +
      "<h3>Account Executives</h3><ul>" +
      "<li><b>Total practices:</b> the partner network.<ul>" + networks + "</ul></li>" +
      "<li><b>Active, Dabblers:</b> where the practices sit today. <b>YTD penetration:</b> practices that sent a case this year divided by the network, rounded to the nearest percent. <b>MTD net new submitters:</b> practices whose first ever case landed this month.</li>" +
      "<li><b>Chart:</b> submitting practices each month split Active / Dabbler / New (New wins when a practice is both); the dashed top level is the rest of the network, so every bar reaches the network total.</li>" +
      "<li><b>LFX rule:</b> " + esc(ae.lfx) + ". Beacon and Aspen Dental accounts share the store practice id (the four digit office code at the start of the practice name).</li></ul>" +
      "<h3>Account Managers</h3><ul>" +
      "<li><b>Book:</b> " + esc(am.book) + ". Beacon LFX cases go to whoever manages that store's Aspen Dental account.</li>" +
      "<li><b>Submitters YTD:</b> practices in the book with a case this year. <b>Cases per business day:</b> " + esc(am.pace_avg || am.pace) + ".</li>" +
      "<li><b>Became active / lost active status, L30D (last 30 days):</b> " + esc(am.moves) + ", comparing today with 30 days ago.</li>" +
      "<li><b>Retention:</b> " + esc(am.retention) + ". Still active, now dabbler and now inactive add up to the practices that were active at the start of the quarter; active today = still active + practices that became active since.</li>" +
      "<li><b>Case volume by business day:</b> the trailing 60 calendar days shown as business days; Mondays are labeled and shaded darker; the gold line is the average per business day for each week.</li>" +
      "<li><b>Revenue and case utilization:</b> " + esc(am.revenue) + ". One line per book; the cases bars are the whole book.</li>" +
      "<li><b>Week over week:</b> for each week of the quarter, practices that crossed the active bar upward (green) or moved from Core to Super Active (dark green) stack above the axis; practices that crossed the active bar downward (red) or went from Dabbler to inactive (dark red) stack below; the net of all four is under each week. * marks the partial week.</li></ul>" +
      "<h3>Programs</h3><ul>" +
      "<li><b>Book:</b> " + esc(pg.book) + ". There is no network cap: the program's universe is the whole marketable universe.</li>" +
      "<li><b>Submitters YTD, Active, Dabblers:</b> as defined above. <b>Gone quiet:</b> " + esc(pg.quiet) + ".</li>" +
      "<li><b>Chart:</b> new submitters = " + esc(pg.new) + "; gone quiet by month = " + esc(pg.gone_quiet_month) + ". The state table and the week over week chart follow the same rules as the other sections.</li></ul>" +
      "<h3>Plays</h3><p>The Plays boxes are editable on the page (click into them). Edits go into the slide export but are not saved between visits yet.</p>" +
      "<h3>Counting rules</h3><p>Cases are counted the same way as the Account Health app: one business unit per case from the primary product, manufacturing jigs dropped, TRI rebill cases dropped, corporate sample accounts dropped, lab, university and intercompany accounts dropped. The one difference is that Aspen Beacon non-LFX cases are kept here so the Beacon page shows the whole Beacon book.</p>";
  }
  function aboutText() {
    return aboutHTML().replace(/<h3>/g, "\n@@H@@").replace(/<\/h3>/g, "\n").replace(/<li>/g, "• ").replace(/<\/li>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n").replace(/\n@@H@@/g, "\n\n").replace(/@@H@@/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }
  function renderAbout() { byId("about-body").innerHTML = aboutHTML(); }

  /* ============================================================
     Slide export: a PDF deck drawn with jsPDF (vector text in the brand fonts) and
     the page's own SVG charts placed through svg2pdf.  Styled after the board deck:
     textured navy cover and header band, small SK mark, uppercase white titles,
     Lora italic subtitle, Dental Blue rule, light KPI cards with a colored strip.
     ============================================================ */
  var DECK = {
    navy: "#052030", ink: "#0C2C4D", muted: "#8A98A4", gray: "#5A6B79", cardFill: "#F7F9FB", cardLine: "#E3E7EB",
    killian: "#1882C7", dental: "#4ABEEE", gold: "#B3A369", goldInk: "#8A7A42", pale: "#C3E8FA", green: "#1E7B34", red: "#B0242E",
    strips: ["#1882C7", "#4ABEEE", "#B3A369", "#052030", "#1882C7"]
  };
  var DECK_ASSETS = { bg: "logos/deck-bg.jpg", band: "logos/deck-band.jpg", wordmark: "logos/sk-wordmark-white.png" };
  var SK_ICON = (document.querySelector(".logo-icon") || {}).src || "";
  var PDF_LIBS = ["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.4/dist/svg2pdf.umd.min.js"];
  var FONT_FILES = [
    ["fonts/Montserrat-Medium.ttf", "Montserrat", "normal"], ["fonts/Montserrat-Medium.ttf", "Montserrat", "500normal"],
    ["fonts/Montserrat-SemiBold.ttf", "Montserrat", "600normal"], ["fonts/Montserrat-Bold.ttf", "Montserrat", "bold"],
    ["fonts/Montserrat-ExtraBold.ttf", "Montserrat", "800normal"],
    ["fonts/Lora-Regular.ttf", "Lora", "normal"], ["fonts/Lora-Italic.ttf", "Lora", "italic"], ["fonts/Lora-Bold.ttf", "Lora", "bold"]
  ];
  var PAGE_W = 13.333, PAGE_H = 7.5;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = function () { res(); }; s.onerror = function () { rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  function b64(buf) {
    var bytes = new Uint8Array(buf), out = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(out);
  }
  /* rasterize an svg logo through a canvas (jsPDF places png and jpg directly) */
  function rasterize(path) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = 600 / Math.max(img.naturalWidth || 1, 1), cw = Math.round((img.naturalWidth || 300) * scale), ch = Math.round((img.naturalHeight || 100) * scale);
          var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
          cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
          res({ data: cv.toDataURL("image/png"), ratio: cw / ch });
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = path;
    });
  }
  /* the pieces that touch the outside world, so a headless test can swap them */
  var IO = window.__dcpIO || {
    libs: function () { return (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.svg) ? Promise.resolve() : loadScript(PDF_LIBS[0]).then(function () { return loadScript(PDF_LIBS[1]); }); },
    bytes: function (url) { return fetch(url, { cache: "force-cache" }).then(function (r) { if (!r.ok) throw new Error("Could not load " + url); return r.arrayBuffer(); }); },
    image: function (path) {
      if (!path) return Promise.resolve(null);
      if (/^data:/.test(path)) return Promise.resolve({ data: path });
      if (/\.svg$/i.test(path)) return rasterize(path);
      return IO.bytes(path).then(function (buf) { return { data: "data:image/" + (/\.jpe?g$/i.test(path) ? "jpeg" : "png") + ";base64," + b64(buf) }; }).catch(function () { return null; });
    },
    save: function (pdf, name) { pdf.save(name); return Promise.resolve(); }
  };

  function playsOf(subKey, fallback) {
    var el = document.querySelector('.sub[data-sub="' + subKey + '"] .plays-list');
    if (!el) return fallback || [];
    var items = [].map.call(el.querySelectorAll("li"), function (li) { return li.textContent.trim(); }).filter(Boolean);
    return items.length ? items : (fallback || []);
  }
  function blendHex(rgb, a) {
    return "#" + rgb.map(function (c) { var v = Math.round(255 + (c - 255) * a); return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase();
  }

  /* --- drawing primitives (inches) --- */
  function Deck(pdf) {
    this.pdf = pdf; this.n = 0; this.assets = {};
  }
  Deck.prototype.font = function (family, weight, italic) {
    var style = italic ? "italic" : (weight >= 800 ? "800normal" : weight >= 700 ? "bold" : weight >= 600 ? "600normal" : "normal");
    if (family === "Lora" && weight >= 700 && !italic) style = "bold";
    if (family === "Lora" && (weight < 700) && !italic) style = "normal";
    try { this.pdf.setFont(family, style); } catch (e) { this.pdf.setFont("helvetica", weight >= 700 ? "bold" : "normal"); }
  };
  /* o: size (pt), family, weight, italic, color, align, baseline, space (letter spacing in pt), maxWidth (in) */
  Deck.prototype.text = function (str, x, y, o) {
    o = o || {};
    this.font(o.family || "Montserrat", o.weight || 500, !!o.italic);
    this.pdf.setFontSize(o.size || 10);
    this.pdf.setTextColor(o.color || DECK.navy);
    var opt = { align: o.align || "left", baseline: o.baseline || "alphabetic" };
    if (o.space) opt.charSpace = o.space / 72;
    if (o.maxWidth) opt.maxWidth = o.maxWidth;
    this.pdf.text(String(str == null ? "" : str), x, y, opt);
  };
  Deck.prototype.width = function (str, o) {
    o = o || {};
    this.font(o.family || "Montserrat", o.weight || 500, !!o.italic);
    this.pdf.setFontSize(o.size || 10);
    var w = this.pdf.getTextWidth(String(str == null ? "" : str));
    if (o.space) w += (o.space / 72) * Math.max(0, String(str).length - 1);
    return w;
  };
  Deck.prototype.rect = function (x, y, w, h, fill, line, lineW, r) {
    var pdf = this.pdf, mode = fill && line ? "FD" : fill ? "F" : "S";
    if (fill) pdf.setFillColor(fill);
    if (line) { pdf.setDrawColor(line); pdf.setLineWidth(lineW || 0.01); }
    if (r) pdf.roundedRect(x, y, w, h, r, r, mode); else pdf.rect(x, y, w, h, mode);
  };
  Deck.prototype.image = function (img, x, y, w, h) {
    if (!img || !img.data) return;
    try { this.pdf.addImage(img.data, /image\/jpe?g/.test(img.data) ? "JPEG" : "PNG", x, y, w, h); } catch (e) { /* skip a bad image rather than fail the deck */ }
  };
  Deck.prototype.ratio = function (img) {
    if (!img) return 3;
    if (img.ratio) return img.ratio;
    try { var p = this.pdf.getImageProperties(img.data); img.ratio = p.width / p.height; } catch (e) { img.ratio = 3; }
    return img.ratio;
  };
  /* place one of the page's SVG charts: full width of the box, top aligned, never taller than h */
  Deck.prototype.svg = function (svgString, x, y, w, h, fontScale) {
    var vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgString), vw = vb ? +vb[1] : 960, vh = vb ? +vb[2] : 360;
    var dw = w, dh = w * vh / vw;
    if (dh > h) { dh = h; dw = h * vw / vh; }
    if (fontScale && fontScale !== 1) svgString = svgString.replace(/font-size="([\d.]+)"/g, function (m, v) { return 'font-size="' + (Math.round(+v * fontScale * 10) / 10) + '"'; });
    var prepped = svgString
      .replace(/<text /g, '<text font-family="Montserrat" ')
      .replace(/ paint-order="stroke"/g, "").replace(/(<text[^>]*?) stroke="[^"]*"/g, "$1").replace(/(<text[^>]*?) stroke-width="[^"]*"/g, "$1");
    var doc = new DOMParser().parseFromString(prepped, "image/svg+xml"), el = doc.documentElement;
    var host = document.createElement("div");
    host.setAttribute("style", "position:absolute;left:-10000px;top:0;width:" + Math.round(dw * 96) + "px");
    host.appendChild(document.importNode(el, true));
    document.body.appendChild(host);
    var node = host.firstChild;
    return this.pdf.svg(node, { x: x + (w - dw) / 2, y: y, width: dw, height: dh }).then(function () { document.body.removeChild(host); }, function (e) { document.body.removeChild(host); throw e; });
  };

  Deck.prototype.cover = function (title, subtitle) {
    var pdf = this.pdf, A = this.assets;
    if (this.n > 0) pdf.addPage([PAGE_W, PAGE_H], "landscape");
    this.n++;
    if (A.bg && A.bg.data) this.image(A.bg, 0, 0, PAGE_W, PAGE_H); else this.rect(0, 0, PAGE_W, PAGE_H, DECK.navy);
    this.rect(0, 0, PAGE_W, 0.08, DECK.dental);
    if (A.wordmark && A.wordmark.data) { var ww = 5.4, wh = ww / this.ratio(A.wordmark); this.image(A.wordmark, (PAGE_W - ww) / 2, 2.45, ww, wh); }
    else this.text("SPECTRUM KILLIAN", PAGE_W / 2, 2.85, { size: 30, weight: 700, color: "#FFFFFF", align: "center", space: 4 });
    this.text(title, PAGE_W / 2, 3.98, { size: 32, weight: 500, color: "#FFFFFF", align: "center", baseline: "middle" });
    this.rect(5.47, 4.78, 2.4, 0.04, DECK.gold);
    if (subtitle) this.text(subtitle, PAGE_W / 2, 5.31, { size: 12, weight: 700, color: "#DBF2FC", align: "center", baseline: "middle" });
    this.rect(0.7, 6.81, 11.9, 0.02, "#B0B7C3");
  };
  Deck.prototype.content = function (title, subtitle) {
    var pdf = this.pdf, A = this.assets;
    if (this.n > 0) pdf.addPage([PAGE_W, PAGE_H], "landscape");
    this.n++;
    this.rect(0, 0, PAGE_W, PAGE_H, "#FFFFFF");
    if (A.band && A.band.data) this.image(A.band, 0, -0.01, PAGE_W, 0.86); else this.rect(0, 0, PAGE_W, 0.86, DECK.navy);
    if (A.icon) this.image(A.icon, 0.24, 0.08, 0.66, 0.66);
    this.text(String(title).toUpperCase(), 1.02, 0.34, { size: 22, weight: 700, color: "#FFFFFF", baseline: "middle" });
    if (subtitle) this.text(subtitle, 1.05, 0.69, { family: "Lora", italic: true, size: 12, color: DECK.pale, baseline: "middle" });
    var thru = (D.meta && D.meta.data_through) ? "Data through " + longDate(D.meta.data_through) : "";
    if (thru) this.text(thru, PAGE_W - 0.45, 0.46, { size: 10, weight: 700, color: DECK.gold, align: "right", baseline: "middle", space: 1 });
    this.rect(0, 0.85, PAGE_W, 0.05, DECK.dental);
    this.text("SPECTRUM KILLIAN   |   DAILY COMMERCIAL PERFORMANCE   |   CONFIDENTIAL", 0.5, 7.3, { size: 8, weight: 500, color: DECK.muted, baseline: "middle", space: 2 });
    this.text(String(this.n), PAGE_W - 0.45, 7.3, { size: 9, weight: 500, color: DECK.muted, align: "right", baseline: "middle" });
  };
  Deck.prototype.card = function (x, y, w, h, strip) {
    this.rect(x, y, w, h, DECK.cardFill, DECK.cardLine, 0.0104);
    if (strip) this.rect(x, y, w, 0.06, strip);
  };
  /* shrink a one line label until it fits the width (letter spacing goes first, then size) */
  Deck.prototype.fit = function (str, w, o, minSize) {
    var t = {}; Object.keys(o).forEach(function (k) { t[k] = o[k]; });
    while (this.width(str, t) > w) {
      if (t.space) { t.space = 0; continue; }
      if (t.size <= (minSize || 5.5)) break;
      t.size = Math.round((t.size - 0.5) * 10) / 10;
    }
    return t;
  };
  Deck.prototype.kpi = function (x, y, w, h, value, label, sub, strip, valueColor, subColor) {
    this.card(x, y, w, h, strip);
    var lo = this.fit(String(label).toUpperCase(), w - 0.16, { size: 8, weight: 700, color: DECK.ink, align: "center", baseline: "middle", space: 1.5 }, 6);
    this.text(String(label).toUpperCase(), x + w / 2, y + 0.29, lo);
    this.text(value, x + w / 2, y + 0.62, { size: 24, weight: 800, color: valueColor || DECK.navy, align: "center", baseline: "middle" });
    if (sub) {
      var so = this.fit(sub, w - 0.14, { family: "Lora", italic: true, size: 8, color: subColor || DECK.ink, align: "center", baseline: "middle" }, 6);
      this.text(sub, x + w / 2, y + h - 0.17, so);
    }
  };
  Deck.prototype.label = function (x, y, w, text, note) {
    var t = String(text).toUpperCase(), o = this.fit(t, w, { size: 10, weight: 700, color: DECK.ink, baseline: "middle", space: 2 }, 7);
    this.text(t, x, y + 0.13, o);
    if (!note) return;
    var tw = this.width(t, o), room = w - tw - 0.18, no = { size: 8, weight: 500, color: DECK.muted, baseline: "middle" };
    if (room < 0.6) return;
    if (this.width(note, no) > room) no.size = 7;
    var s = String(note);
    while (s.length > 4 && this.width(s, no) > room) s = s.replace(/\.\.\.$/, "").slice(0, -1) + "...";
    this.text(s, x + tw + 0.18, y + 0.13, no);
  };
  Deck.prototype.logoCard = function (x, y, w, h, logos, fallback, tag) {
    this.card(x, y, w, h, null);
    var ok = (logos || []).filter(function (l) { return l && l.data; }), boxH = tag ? h - 0.32 : h, self = this;
    if (!ok.length) this.text(fallback, x + w / 2, y + boxH / 2, { size: 11, weight: 700, color: DECK.navy, align: "center", baseline: "middle" });
    var gap = 0.12, cellW = (w - 0.24 - gap * (Math.max(ok.length, 1) - 1)) / Math.max(ok.length, 1);
    ok.forEach(function (l, i) {
      var r = self.ratio(l), maxH = r < 2 ? boxH - 0.14 : Math.min(0.6, boxH - 0.3);
      var lw = cellW, lh = lw / r;
      if (lh > maxH) { lh = maxH; lw = lh * r; }
      var cx = x + 0.12 + i * (cellW + gap) + cellW / 2;
      self.image(l, cx - lw / 2, y + (boxH - lh) / 2, lw, lh);
    });
    if (tag) this.text(String(tag).toUpperCase(), x + w / 2, y + boxH + 0.11, { size: 7, weight: 700, color: DECK.goldInk, align: "center", baseline: "middle", space: 2 });
  };
  Deck.prototype.plays = function (x, y, w, h, title, items) {
    this.card(x, y, w, h, DECK.gold);
    this.text(String(title).toUpperCase(), x + 0.15, y + 0.27, { size: 9, weight: 700, color: DECK.ink, baseline: "middle", space: 2 });
    var pdf = this.pdf, yy = y + 0.55, size = items.length > 5 ? 9.5 : 11, lh = size * 1.4 / 72, self = this;
    this.font("Lora", 400, false); pdf.setFontSize(size);
    items.forEach(function (p) {
      var lines = pdf.splitTextToSize(p, w - 0.55);
      if (yy + lines.length * lh > y + h - 0.1) return;
      self.text("•", x + 0.17, yy, { family: "Lora", size: size, color: DECK.navy });
      lines.forEach(function (ln) { self.text(ln, x + 0.36, yy, { family: "Lora", size: size, color: DECK.navy }); yy += lh; });
      yy += 6 / 72;
    });
  };
  /* the state table: one row per state, one column per period, cells tinted by the change from the period before */
  Deck.prototype.stateTable = function (x, y, w, t, rowH) {
    rowH = rowH || 0.24;
    var n = t.columns.length, firstW = 1.6, colW = (w - firstW) / n, self = this, fs = n > 14 ? 5.5 : n > 10 ? 6.5 : 7.5;
    this.text(("STATE AT " + t.kind + " END").toUpperCase(), x + 0.04, y + rowH / 2, { size: 6.5, weight: 700, color: DECK.ink, baseline: "middle", space: 1 });
    t.columns.forEach(function (c, i) { self.text(c.label + (c.partial ? "*" : ""), x + firstW + colW * i + colW / 2, y + rowH / 2, { size: fs, weight: 700, color: DECK.ink, align: "center", baseline: "middle" }); });
    t.rows.forEach(function (r, ri) {
      var yy = y + rowH * (ri + 1);
      self.rect(x, yy + 0.01, firstW - 0.02, rowH - 0.02, DECK.cardFill);
      self.text(r.label, x + 0.06, yy + rowH / 2, { size: 7.5, weight: 700, color: DECK.navy, baseline: "middle" });
      r.values.forEach(function (v, i) {
        var d = r.deltas[i], fill = "#F7F9FB", col = DECK.gray;
        if (d != null && d !== 0 && r.tone !== "neutral") {
          var good = r.tone === "good_up" ? d > 0 : d < 0, mag = Math.min(1, Math.abs(d) / 6);
          fill = good ? blendHex([52, 199, 89], 0.16 + 0.5 * mag) : blendHex([239, 68, 68], 0.12 + 0.46 * mag);
          col = good ? DECK.green : DECK.red;
        } else if (d != null && d !== 0) fill = blendHex([176, 183, 195], 0.26);
        var cx = x + firstW + colW * i;
        self.rect(cx + 0.01, yy + 0.01, colW - 0.02, rowH - 0.02, fill);
        self.text(fmtN(v) + (d == null || d === 0 ? "" : " (" + signed(d) + ")"), cx + colW / 2, yy + rowH / 2, { size: fs, weight: 700, color: col, align: "center", baseline: "middle" });
      });
    });
    return y + rowH * (t.rows.length + 1);
  };

  function defaultStates(states) { return states[states["default"] || "year_month"]; }

  Deck.prototype.aeSlide = function (sub, logo) {
    var c = sub.cards, self = this;
    this.content(sub.title, "Account Executives  |  " + sub.ae);
    this.logoCard(0.5, 1.05, 1.9, 1.05, [logo], sub.title);
    [["" + fmtN(c.total), "Total practices", DECK.navy, ""], ["" + fmtN(c.active), "Active", DECK.killian, ""], ["" + fmtN(c.dabblers), "Dabblers", DECK.navy, ""],
     [fmtPct(c.penetration_pct), "YTD penetration", DECK.goldInk, fmtN(c.ytd_submitters) + " / " + fmtN(c.total) + " practices submitted a case YTD"], ["" + fmtN(c.mtd_net_new), "MTD net new submitters", DECK.killian, ""]
    ].forEach(function (k, i) { self.kpi(2.55 + i * 2.06, 1.05, 1.96, 1.05, k[0], k[1], k[3], DECK.strips[i], k[2]); });
    this.label(0.5, 2.3, 8.2, "Submitting practices by month", AE.year + " YTD, dashed top level = rest of the network (" + fmtN(sub.network) + ")");
    var t = defaultStates(sub.states);
    this.plays(8.95, 2.3, 3.9, 4.65, "Plays", playsOf(sub.key, sub.plays));
    return this.svg(chartSVG(sub.months, sub.network, 960, 300), 0.5, 2.55, 8.2, 2.6).then(function () {
      self.label(0.5, 5.22, 8.2, statesTitle(t), "count at " + t.kind + " end, change from the " + t.kind + " before; * partial " + t.kind);
      self.stateTable(0.5, 5.5, 8.2, t, 0.24);
    });
  };
  Deck.prototype.amSlide = function (sub, logos) {
    var c = sub.cards, self = this;
    this.content(sub.name, "Account Managers  |  " + sub.label);
    this.logoCard(0.5, 1.05, 2.6, 1.05, logos, sub.name, sub.logo_tag);
    [["" + fmtN(c.submitters_ytd), "Submitters YTD", "", DECK.killian, null],
     [fmtN(Math.round(c.avg_per_day_mtd)), "Cases Booked per Day, " + c.month_label + "'" + String(AM.year).slice(-2), avgTickerText(c), DECK.navy, c.avg_pct == null ? DECK.ink : c.avg_pct >= 0 ? DECK.green : DECK.red],
     ["+" + fmtN(c.promoted_30), "Became active L30D", "", DECK.green, null],
     ["-" + fmtN(c.demoted_30), "Lost active status L30D", "", DECK.red, null]
    ].forEach(function (k, i) { self.kpi(3.25 + i * 2.42, 1.05, 2.32, 1.05, k[0], k[1], k[2], DECK.strips[i], k[3], k[4]); });
    this.label(0.5, 2.3, 12.33, "Case volume by business day", "trailing 60 days, " + fmtN(sub.daily.total) + " cases; gold = weekly average per business day");
    var colW = 3.98, gap = 0.195, y2 = 4.9, cy = 5.16, ch = 1.94, fs = 1.3;
    return this.svg(dailySVG(sub.daily.days, 1500, 280), 0.5, 2.53, 12.33, 2.32).then(function () {
      self.label(0.5, y2, colW, "Retention, " + sub.retention.quarter, "who is still active; revenue vs " + sub.retention.prev_quarter);
      return self.svg(retentionSVG(sub.retention, 640, 315), 0.5, cy, colW, ch, 1.15);
    }).then(function () {
      self.label(0.5 + colW + gap, y2, colW, "Revenue and case utilization", "invoiced, " + AM.year + " YTD" + (sub.revenue.mtd_factor != null ? ", " + sub.revenue.mtd_label + " at run rate" : ""));
      return self.svg(lineSVG(sub.revenue, 640, 315), 0.5 + colW + gap, cy, colW, ch, fs);
    }).then(function () {
      self.label(0.5 + 2 * (colW + gap), y2, colW, "Week over week, " + sub.weekly.quarter, "up in greens, down in reds, net below");
      return self.svg(wowSVG(sub.weekly, 640, 315), 0.5 + 2 * (colW + gap), cy, colW, ch, fs);
    });
  };
  Deck.prototype.programSlide = function (sub, logo) {
    var c = sub.cards, self = this;
    this.content(sub.title, "Programs  |  Marketing");
    this.logoCard(0.5, 1.05, 1.9, 1.05, [logo], sub.title);
    this.kpi(2.55, 1.05, 2.3, 1.05, "" + fmtN(c.submitters_ytd), "Submitters YTD", "", DECK.killian, DECK.killian);
    this.text("=", 5.05, 1.6, { size: 24, weight: 700, color: DECK.muted, align: "center", baseline: "middle" });
    [["" + fmtN(c.active), "Active", DECK.killian], ["" + fmtN(c.dabblers), "Dabblers", DECK.navy], ["" + fmtN(c.gone_quiet), "Gone quiet", DECK.red]]
      .forEach(function (k, i) { self.kpi(5.25 + i * 2.6, 1.05, 2.45, 1.05, k[0], k[1], "", DECK.killian, k[2]); });
    this.label(0.5, 2.3, 8.2, "New submitters and gone quiet by month", PG.year + " YTD; blue = first ever case, red = 90 days without a case");
    var t = defaultStates(sub.states);
    return this.svg(newQuietSVG(sub.months, 960, 300), 0.5, 2.55, 8.2, 2.6).then(function () {
      self.label(0.5, 5.22, 8.2, statesTitle(t), "count at " + t.kind + " end, change from the " + t.kind + " before; * partial " + t.kind);
      self.stateTable(0.5, 5.5, 8.2, t, 0.24);
      self.label(8.95, 2.3, 3.9, "Week over week, " + sub.weekly.quarter, "up in greens, down in reds");
      return self.svg(wowSVG(sub.weekly, 560, 330), 8.95, 2.55, 3.9, 2.3);
    }).then(function () {
      self.plays(8.95, 5.0, 3.9, 1.95, "Plays: initiatives and growth", playsOf("pg-" + sub.key, sub.plays));
    });
  };
  Deck.prototype.aboutSlide = function () {
    this.content("About", "Definitions and counting rules");
    var pdf = this.pdf, self = this, colW = 6.0, cols = [0.5, 6.85], col = 0, y = 1.1, top = 1.1, bottom = 7.05;
    var parts = aboutText().split("\n\n").filter(Boolean);
    function line(str, o, lh) {
      if (y + lh > bottom && col === 0) { col = 1; y = top; }
      if (y + lh > bottom) return;
      self.text(str, cols[col] + (o.indent || 0), y, o);
      y += lh;
    }
    parts.forEach(function (p) {
      var lines = p.split("\n").filter(Boolean);
      y += 0.05;
      line(lines[0].toUpperCase(), { size: 7.5, weight: 700, color: DECK.ink, space: 1.2 }, 0.16);
      lines.slice(1).forEach(function (l) {
        var bullet = l.indexOf("• ") === 0, txt = bullet ? l.slice(2) : l;
        self.font("Lora", 400, false); pdf.setFontSize(6.6);
        var wrapped = pdf.splitTextToSize(txt, colW - (bullet ? 0.18 : 0));
        wrapped.forEach(function (w, i) {
          if (bullet && i === 0 && !(y + 0.115 > bottom && col === 1)) { if (y + 0.115 > bottom && col === 0) { col = 1; y = top; } self.text("•", cols[col], y, { family: "Lora", size: 6.6, color: DECK.navy }); }
          line(w, { family: "Lora", size: 6.6, color: DECK.navy, indent: bullet ? 0.18 : 0 }, 0.115);
        });
        y += 0.02;
      });
    });
  };

  function fetchFonts(pdf) {
    return Promise.all(FONT_FILES.map(function (f) { return IO.bytes(f[0]).then(function (buf) { return b64(buf); }); })).then(function (blobs) {
      FONT_FILES.forEach(function (f, i) { var vf = f[0].split("/").pop() + "-" + f[2]; pdf.addFileToVFS(vf, blobs[i]); pdf.addFont(vf, f[1], f[2]); });
    });
  }
  function exportSlides() {
    var btn = byId("btn-pptx"), st = byId("pptx-status");
    btn.disabled = true; st.textContent = "Loading the PDF library...";
    var aeSubs = (AE && AE.subsections) || [], amSubs = (AM && AM.subsections) || [], pgSubs = (PG && PG.subsections) || [];
    var pdf, deck, total = 0;
    return IO.libs().then(function () {
      st.textContent = "Preparing fonts, logos and artwork...";
      pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "in", format: [PAGE_W, PAGE_H], compress: true });
      pdf.setProperties({ title: "Daily Commercial Performance", author: "Spectrum Killian", creator: "Spectrum Killian" });
      deck = new Deck(pdf);
      return Promise.all([
        fetchFonts(pdf),
        Promise.all(aeSubs.map(function (sub) { return IO.image(sub.logo); })),
        Promise.all(amSubs.map(function (sub) { return Promise.all((sub.logos || []).map(function (p) { return IO.image(p); })); })),
        Promise.all(pgSubs.map(function (sub) { return IO.image(sub.logo); })),
        IO.image(DECK_ASSETS.bg), IO.image(DECK_ASSETS.band), IO.image(DECK_ASSETS.wordmark), IO.image(SK_ICON)
      ]);
    }).then(function (res) {
      deck.assets = { bg: res[4], band: res[5], wordmark: res[6], icon: res[7] };
      st.textContent = "Drawing slides...";
      var dateLine = (D.meta && D.meta.data_through) ? longDate(D.meta.data_through) : "";
      deck.cover("Daily Commercial Performance", dateLine ? "Data through " + dateLine : "");
      var chain = Promise.resolve();
      if (aeSubs.length) chain = chain.then(function () { deck.cover("Account Executives", aeSubs.map(function (x) { return x.title; }).join("  ·  ")); });
      aeSubs.forEach(function (sub, i) { chain = chain.then(function () { return deck.aeSlide(sub, res[1][i]); }); });
      if (amSubs.length) chain = chain.then(function () { deck.cover("Account Managers", amSubs.map(function (x) { return x.name.split(" ")[0]; }).join("  ·  ")); });
      amSubs.forEach(function (sub, i) { chain = chain.then(function () { return deck.amSlide(sub, res[2][i]); }); });
      if (pgSubs.length) chain = chain.then(function () { deck.cover("Programs", pgSubs.map(function (x) { return x.title; }).join("  ·  ")); });
      pgSubs.forEach(function (sub, i) { chain = chain.then(function () { return deck.programSlide(sub, res[3][i]); }); });
      return chain.then(function () { deck.aboutSlide(); });
    }).then(function () {
      total = deck.n;
      var fname = "Daily Commercial Performance " + ((D.meta && D.meta.run_date) || "") + ".pdf";
      return IO.save(pdf, fname);
    }).then(function () {
      st.textContent = total + " slides exported as a PDF.";
      btn.disabled = false;
      return pdf;
    }).catch(function (err) {
      st.textContent = "Export failed: " + (err && err.message ? err.message : err);
      btn.disabled = false;
      throw err;
    });
  }
  byId("btn-pptx").addEventListener("click", function () { exportSlides().catch(function () { /* reported in the status line */ }); });
  window.__dcpExport = exportSlides;

  /* ---------- boot ---------- */
  var blocks = [].slice.call(document.querySelectorAll("section.block"));
  renderAE();
  renderAM();
  renderPrograms();
  renderAbout();

  /* ---------- scroll-spy: the pill of the section in view stays lit; anchor offset follows the banner height ---------- */
  var header = document.querySelector(".banner");
  var pills = [].slice.call(document.querySelectorAll(".pill"));
  function setActive(id) {
    pills.forEach(function (p) {
      var on = p.getAttribute("data-sec") === id;
      p.classList.toggle("active", on);
      if (on) p.setAttribute("aria-current", "true"); else p.removeAttribute("aria-current");
    });
  }
  function spy() {
    document.documentElement.style.scrollPaddingTop = (header.offsetHeight + 24) + "px";
    var y = window.scrollY + header.offsetHeight + 40;
    var cur = blocks[0].id;
    for (var i = 0; i < blocks.length; i++) { if (blocks[i].offsetTop <= y) cur = blocks[i].id; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) cur = blocks[blocks.length - 1].id;
    setActive(cur);
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { spy(); ticking = false; });
  }, { passive: true });
  window.addEventListener("resize", spy);
  window.addEventListener("hashchange", function () { setTimeout(spy, 350); });
  spy();
})();
