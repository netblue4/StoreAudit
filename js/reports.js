/* reports.js — printable report renderers (summary, remediation, progress).
   Pure functions returning HTML strings from an audit object. */
(function () {
  "use strict";
  var M = window.Model;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(d) {
    if (!d) return "—";
    try { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return d; }
  }
  function sevClass(s) { return "sev-" + String(s || "Major").toLowerCase(); }
  function badge(cls, text) { return '<span class="badge ' + cls + '">' + esc(text) + "</span>"; }
  function statusBadge(st) { var map = { open: "Open", "in-progress": "In progress", fixed: "Fixed" }; return badge(st, map[st] || st); }
  function bandBadge(band, pass) {
    if (!band) return "";
    var cls = pass ? "pass" : "fail";
    return '<span class="badge ' + cls + '">' + esc(band) + "</span>";
  }

  function reportHead(audit, subtitle) {
    var s = audit.store, a = audit.audit;
    return '<div class="card">' +
      '<div class="row between" style="align-items:flex-start">' +
        '<div>' +
          '<h1 style="margin-bottom:2px">' + esc(s.name || "Store") + "</h1>" +
          '<div class="muted small">' + esc(audit.auditName || audit.auditType || "") +
            (s.storeType ? " &middot; " + esc(s.storeType) : "") + " &middot; " + esc(subtitle) + "</div>" +
        "</div>" +
        '<div class="small muted" style="text-align:right">' +
          (s.siteId ? "Site ID: <b>" + esc(s.siteId) + "</b><br>" : "") +
          "Audit date: <b>" + fmtDate(a.date) + "</b><br>" +
          (a.auditorName ? "Auditor: <b>" + esc(a.auditorName) + "</b><br>" : "") +
          (s.responsiblePerson ? "Responsible: <b>" + esc(s.responsiblePerson) + "</b>" : "") +
        "</div>" +
      "</div>" +
      (s.address ? '<div class="small muted mt">' + esc(s.address) + "</div>" : "") +
    "</div>";
  }

  // ---------- SUMMARY REPORT (section-level) ----------
  function summaryHTML(audit) {
    var overall = M.scoreOverall(audit);
    var rows = "";
    M.categoriesOf(audit).forEach(function (cat) {
      var s = M.scoreCategory(audit, cat);
      var pctCell = s.na === s.total ? '<span class="badge na">N/A</span>' : "<b>" + s.pct + "%</b>";
      rows += "<tr" + (s.pass ? "" : ' class="failrow"') + ">" +
        "<td>" + esc(cat.name) + "</td>" +
        '<td class="num">' + s.weight + "</td>" +
        '<td class="num">' + s.score + "</td>" +
        '<td class="num">' + pctCell + "</td>" +
        "<td>" + (s.na === s.total ? badge("na", "N/A") : (s.pass ? badge("pass", "Pass") : badge("fail", "Fail"))) + "</td>" +
      "</tr>";
    });
    return reportHead(audit, "Summary Findings Report") +
      '<div class="card">' +
        '<div class="row between mb">' +
          '<h2 style="margin:0">Score Summary</h2>' +
          "<div>" +
            (overall.pass ? badge("pass", "PASS — " + overall.pct + "%") : badge("fail", "FAIL — " + overall.pct + "%")) +
            " " + bandBadge(overall.band, overall.pass) +
            ' <span class="muted small">min ' + overall.threshold + "% to pass</span></div>" +
        "</div>" +
        '<div class="tbl-wrap"><table class="data">' +
          '<thead><tr><th>Section</th><th class="num">Weight</th><th class="num">Score</th><th class="num">%</th><th>Result</th></tr></thead>' +
          "<tbody>" + rows + "</tbody>" +
          '<tfoot><tr><td>Overall</td><td class="num">' + overall.weight + '</td><td class="num">' + overall.score +
            '</td><td class="num">' + overall.pct + "%</td><td>" + (overall.pass ? badge("pass", "Pass") : badge("fail", "Fail")) + "</td></tr></tfoot>" +
        "</table></div>" +
        (overall.complete ? "" : '<div class="small muted mt">Note: audit is not fully answered yet — percentages reflect current progress.</div>') +
        '<div class="small muted mt">Section-level only. Individual failed questions appear in the Remediation Report.</div>' +
      "</div>";
  }

  // ---------- REMEDIATION REPORT ----------
  function remediationHTML(audit) {
    var items = audit.remediation.items || [];
    if (!items.length) {
      return reportHead(audit, "Remediation Report") +
        '<div class="card empty"><div class="big-ic">✓</div><h3>No delinquent findings</h3>' +
        '<p class="muted">No Critical or Major questions were scored below target, so there is nothing to remediate.</p></div>';
    }
    var prog = M.remediationProgress(audit);
    var body = items.map(function (it, i) {
      var st = M.currentStatus(audit, it), cur = M.currentScore(audit, it), hist = M.itemHistory(audit, it);
      var histHTML = "";
      if (hist.length) {
        histHTML = '<div class="hist"><div class="tiny muted" style="font-weight:700;text-transform:uppercase">Revisit history</div>' +
          hist.map(function (h) {
            return '<div class="h-entry">' + fmtDate(h.date) + " &middot; " + statusBadge(h.status || "open") +
              (typeof h.newScore === "number" ? ' <span class="mono">score ' + h.newScore + "/" + it.maxScore + "</span>" : "") +
              (h.auditorName ? ' <span class="muted">by ' + esc(h.auditorName) + "</span>" : "") +
              (h.note ? '<br><span class="muted">' + esc(h.note) + "</span>" : "") +
              (h.photo ? '<br><img class="thumb" src="' + h.photo + '" alt="evidence">' : "") + "</div>";
          }).join("") + "</div>";
      }
      return '<div class="rem-item ' + sevClass(it.severity) + '">' +
        '<div class="rem-head"><span class="idx">#' + (i + 1) + "</span>" + badge(it.severity.toLowerCase(), it.severity) + statusBadge(st) +
          '<span class="grow"></span><span class="tiny muted mono">' + esc(it.category) + " &middot; " + esc(it.ref) + "</span></div>" +
        '<div class="rem-body">' +
          '<div style="font-weight:700">' + esc(it.question) + "</div>" +
          (it.group ? '<div class="tiny muted">' + esc(it.group) + "</div>" : "") +
          '<div class="kv">' +
            '<div class="k">Score at audit</div><div class="mono">' + it.auditScore + " / " + it.maxScore + "</div>" +
            (cur !== it.auditScore ? '<div class="k">Latest score</div><div class="mono">' + cur + " / " + it.maxScore + "</div>" : "") +
            (it.reason ? '<div class="k">Finding</div><div>' + esc(it.reason) + "</div>" : "") +
            (it.guidance ? '<div class="k">What to check</div><div class="muted small">' + esc(it.guidance) + "</div>" : "") +
          "</div>" +
          (it.auditPhoto ? '<div class="mt"><img class="thumb" src="' + it.auditPhoto + '" alt="evidence"></div>' : "") +
          histHTML +
        "</div>" +
      "</div>";
    }).join("");
    return reportHead(audit, "Remediation Report") +
      '<div class="card"><div class="row between"><h2 style="margin:0">Action Items</h2><div>' +
        sevSummary(prog) + "</div></div>" +
        '<div class="small muted mt">' + prog.total + " findings &middot; " + prog.fixed + " fixed, " +
          prog["in-progress"] + " in progress, " + prog.open + " open (" + prog.pctFixed + "% fixed)</div>" +
      "</div>" + body;
  }

  function sevSummary(prog) {
    return M.severityLevels().map(function (s) {
      var d = prog.sev[s]; if (!d || !d.t) return "";
      return badge(s.toLowerCase(), d.t + " " + s);
    }).filter(Boolean).join(" ");
  }

  // ---------- PROGRESS ----------
  function progressHTML(audit) {
    var prog = M.remediationProgress(audit);
    if (!prog.total) return '<div class="card empty muted">No remediation items yet. Generate the remediation report first.</div>';
    function seg(cls, n, label) {
      if (!n) return "";
      var pct = (n / prog.total) * 100;
      return '<span class="' + cls + '" style="width:' + pct + '%">' + (pct > 12 ? n + " " + label : n) + "</span>";
    }
    var stack = seg("s-fixed", prog.fixed, "fixed") + seg("s-prog", prog["in-progress"], "in prog") + seg("s-open", prog.open, "open");
    var revRows = "";
    (audit.revisits || []).forEach(function (rv, i) {
      var snap = { fixed: 0, "in-progress": 0, open: 0 };
      (audit.remediation.items || []).forEach(function (it) {
        var st = it.status || "open";
        for (var j = 0; j <= i; j++) { var u = audit.revisits[j].updates && audit.revisits[j].updates[it.id]; if (u && u.status) st = u.status; }
        snap[st] = (snap[st] || 0) + 1;
      });
      revRows += "<tr><td>" + fmtDate(rv.date) + "</td><td>" + esc(rv.auditorName || "—") + "</td>" +
        '<td class="num">' + snap.fixed + '</td><td class="num">' + snap["in-progress"] + '</td><td class="num">' + snap.open +
        "</td><td>" + esc(rv.notes || "") + "</td></tr>";
    });
    return '<div class="card"><h2>Remediation Progress</h2>' +
      '<div class="flow mt">' +
        '<div class="step"><div class="n">' + prog.total + '</div><div class="muted small">Problems found</div></div>' +
        '<div class="step"><div class="n" style="color:var(--green)">' + prog.fixed + '</div><div class="muted small">Fixed</div></div>' +
        '<div class="step"><div class="n" style="color:var(--amber)">' + prog["in-progress"] + '</div><div class="muted small">In progress</div></div>' +
        '<div class="step"><div class="n" style="color:var(--red)">' + prog.open + '</div><div class="muted small">Still open</div></div>' +
      "</div>" +
      '<div class="mt2"><div class="row between"><span class="small muted">Overall completion</span><b>' + prog.pctFixed + "%</b></div>" +
      '<div class="stack mt">' + (stack || '<span class="s-open" style="width:100%">—</span>') + "</div></div>" +
      '<div class="mt2"><h3>By severity</h3>' + sevBars(prog) + "</div>" +
      (revRows ? '<div class="mt2"><h3>Visit-by-visit</h3><div class="tbl-wrap"><table class="data"><thead><tr><th>Revisit date</th><th>Auditor</th><th class="num">Fixed</th><th class="num">In progress</th><th class="num">Open</th><th>Notes</th></tr></thead><tbody>' + revRows + "</tbody></table></div></div>" : "") +
    "</div>";
  }
  function sevBars(prog) {
    return M.severityLevels().map(function (sv) {
      var d = prog.sev[sv]; if (!d || !d.t) return "";
      var pct = Math.round((d.fixed / d.t) * 100);
      return '<div class="mt" style="display:flex;align-items:center;gap:10px">' +
        '<span style="min-width:80px">' + badge(sv.toLowerCase(), sv) + "</span>" +
        '<div class="pbar green grow"><span style="width:' + pct + '%"></span></div>' +
        '<span class="small mono" style="min-width:70px;text-align:right">' + d.fixed + "/" + d.t + " (" + pct + "%)</span></div>";
    }).filter(Boolean).join("");
  }

  window.Reports = {
    summaryHTML: summaryHTML, remediationHTML: remediationHTML, progressHTML: progressHTML,
    esc: esc, fmtDate: fmtDate, statusBadge: statusBadge, sevClass: sevClass, badge: badge, bandBadge: bandBadge
  };
})();
