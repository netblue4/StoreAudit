/* app.js — views, router, and interaction for StoreAudit. */
(function () {
  "use strict";
  var M = window.Model, R = window.Reports;
  var esc = R.esc, fmtDate = R.fmtDate, badge = R.badge;

  var view = document.getElementById("view");
  var headerCtx = document.getElementById("headerCtx");

  var State = { current: null, activeCat: null, route: "dashboard" };

  // ---------------- infra: toast, modal, files ----------------
  function toast(msg, kind) {
    var el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    document.getElementById("toast").appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    setTimeout(function () { el.classList.remove("show"); setTimeout(function () { el.remove(); }, 250); }, 2600);
  }

  function modal(html, opts) {
    opts = opts || {};
    var root = document.getElementById("modalRoot");
    root.innerHTML = '<div class="modal-bg"><div class="modal">' + html + "</div></div>";
    var bg = root.querySelector(".modal-bg");
    bg.addEventListener("click", function (e) { if (e.target === bg && !opts.sticky) closeModal(); });
    return root;
  }
  function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }

  function downloadJSON(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  // read image file -> downscaled JPEG dataURL
  function readPhoto(file, cb) {
    if (!file) return cb(null);
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1100, w = img.width, h = img.height;
        if (w > max || h > max) { var s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        try { cb(cv.toDataURL("image/jpeg", 0.72)); }
        catch (e) { cb(reader.result); }
      };
      img.onerror = function () { cb(reader.result); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------------- router ----------------
  window.App = {
    go: function (route, param) {
      State.route = route;
      window.scrollTo(0, 0);
      closeModal();
      ({
        dashboard: renderDashboard,
        newAudit: renderNewAudit,
        audit: renderAudit,
        summary: renderSummary,
        remediation: renderRemediation,
        revisit: renderRevisit,
        progress: renderProgress
      }[route] || renderDashboard)(param);
      renderHeaderCtx();
    },
    // exposed for inline handlers
    openAudit: function (id) { State.current = M.getAudit(id); State.activeCat = M.CHECKLIST.categories[0].id; App.go("audit"); },
    _state: State
  };

  function renderHeaderCtx() {
    if (State.current && ["audit", "summary", "remediation", "revisit", "progress"].indexOf(State.route) >= 0) {
      var a = State.current;
      headerCtx.innerHTML = '<span class="ctx-store"><b>' + esc(a.store.name) + '</b><span class="hide-phone"> &middot; ' + fmtDate(a.audit.date) + "</span></span>" +
        '<a class="btn sm ghost no-print nowrap" style="color:#fff;border-color:rgba(255,255,255,.3)" href="#" onclick="App.go(\'dashboard\');return false">All audits</a>';
    } else {
      headerCtx.innerHTML = "";
    }
  }

  // ---------------- Dashboard ----------------
  function renderDashboard() {
    var audits = M.listAudits();
    var cards = audits.map(function (a) {
      var ov = M.scoreOverall(a);
      var prog = M.remediationProgress(a);
      return '<div class="card audit-card" onclick="App.openAudit(\'' + a.id + '\')">' +
        '<div class="store">' + esc(a.store.name || "Untitled store") + "</div>" +
        '<div class="meta">' + fmtDate(a.audit.date) + (a.store.siteId ? " &middot; " + esc(a.store.siteId) : "") +
          (a.audit.auditorName ? " &middot; " + esc(a.audit.auditorName) : "") + "</div>" +
        '<div class="stat-row">' +
          '<div><div class="big" style="color:' + (ov.pass ? "var(--green)" : "var(--red)") + '">' + ov.pct + "%</div>" +
            '<div class="tiny muted">' + (ov.pass ? "Pass" : "Fail") + " &middot; " + (ov.complete ? "complete" : ov.answered + "/" + ov.total) + "</div></div>" +
          (prog.total ? '<div><div class="big">' + prog.fixed + "/" + prog.total + '</div><div class="tiny muted">remediated</div></div>' : "") +
          (a.revisits && a.revisits.length ? '<div><div class="big">' + a.revisits.length + '</div><div class="tiny muted">revisits</div></div>' : "") +
        "</div>" +
      "</div>";
    }).join("");

    view.innerHTML =
      '<div class="row between mb">' +
        "<div><h1>Store Audits</h1><div class=\"muted small\">" + M.CHECKLIST.meta.title + " &middot; v" + esc(M.CHECKLIST.meta.version || "") + "</div></div>" +
        '<div class="row">' +
          '<button class="btn" onclick="App.importPrompt()">⭱ Import JSON</button>' +
          '<button class="btn primary" onclick="App.go(\'newAudit\')">＋ New Audit</button>' +
        "</div>" +
      "</div>" +
      (audits.length ? '<div class="audit-list">' + cards + "</div>" :
        '<div class="card empty"><div class="big-ic">📋</div><h3>No audits yet</h3>' +
        '<p class="muted">Start a new audit, or import a saved <span class="mono">Store_Date.json</span> file from a previous visit.</p>' +
        '<div class="row" style="justify-content:center"><button class="btn primary" onclick="App.go(\'newAudit\')">＋ New Audit</button>' +
        '<button class="btn" onclick="App.importPrompt()">⭱ Import JSON</button></div></div>');
  }

  App.importPrompt = function () {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json,.json";
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(reader.result);
          var a = M.importAudit(obj);
          toast("Imported " + a.store.name, "ok");
          App.openAudit(a.id);
        } catch (e) { toast("Import failed: " + e.message, "err"); }
      };
      reader.readAsText(f);
    };
    inp.click();
  };

  // ---------------- New Audit ----------------
  function renderNewAudit() {
    view.innerHTML =
      '<div class="row between mb"><h1>New Audit</h1>' +
      '<button class="btn ghost" onclick="App.go(\'dashboard\')">Cancel</button></div>' +
      '<div class="card" style="max-width:720px">' +
        '<div class="form-grid">' +
          field("Store name *", "na_name", "text", "e.g. SPAR Turner and Haupt") +
          field("Site / Store ID", "na_site", "text", "e.g. 35076 WC") +
          field("Audit date *", "na_date", "date", "", M.todayISO()) +
          field("Auditor name", "na_auditor", "text", "") +
          field("Responsible person (store)", "na_resp", "text", "") +
          field("Who accompanied", "na_acc", "text", "") +
        "</div>" +
        '<label class="field"><span>Store address</span><textarea id="na_addr" placeholder="Optional"></textarea></label>' +
        '<div class="row mt"><button class="btn primary" onclick="App.createAudit()">Start audit →</button></div>' +
      "</div>";
    setTimeout(function () { var el = document.getElementById("na_name"); if (el) el.focus(); }, 30);
  }
  function field(label, id, type, ph, val) {
    return '<label class="field"><span>' + label + "</span>" +
      '<input id="' + id + '" type="' + type + '" placeholder="' + esc(ph || "") + '" value="' + esc(val || "") + '"></label>';
  }
  App.createAudit = function () {
    var name = document.getElementById("na_name").value.trim();
    var date = document.getElementById("na_date").value || M.todayISO();
    if (!name) { toast("Store name is required", "err"); return; }
    var existing = M.getAudit(M.slug(name) + "_" + date);
    if (existing && !confirm("An audit for this store and date already exists. Open it instead?")) return;
    if (existing) { App.openAudit(existing.id); return; }
    var a = M.newAudit({
      name: name, date: date,
      siteId: document.getElementById("na_site").value.trim(),
      auditorName: document.getElementById("na_auditor").value.trim(),
      responsiblePerson: document.getElementById("na_resp").value.trim(),
      whoAccompanied: document.getElementById("na_acc").value.trim(),
      address: document.getElementById("na_addr").value.trim()
    });
    M.saveAudit(a);
    State.current = a; State.activeCat = M.CHECKLIST.categories[0].id;
    toast("Audit created", "ok");
    App.go("audit");
  };

  // ---------------- Audit screen ----------------
  function renderAudit() {
    if (!State.current) return App.go("dashboard");
    if (!State.activeCat) State.activeCat = M.CHECKLIST.categories[0].id;
    view.innerHTML =
      '<div class="tabs no-print">' + tabBar("audit") + "</div>" +
      '<div class="audit-layout">' +
        '<div class="cat-nav no-print"><div class="card" id="catNav"></div></div>' +
        '<div id="catPanel"></div>' +
      "</div>";
    renderCatNav();
    renderCatPanel();
  }

  function tabBar(active) {
    var tabs = [["audit", "Audit"], ["summary", "Summary Report"], ["remediation", "Remediation"], ["progress", "Progress"]];
    return tabs.map(function (t) {
      return '<div class="tab' + (t[0] === active ? " active" : "") + '" onclick="App.go(\'' + t[0] + '\')">' + t[1] + "</div>";
    }).join("") +
    '<span class="grow"></span>' +
    '<div class="tab" onclick="App.exportCurrent()">⭳ Export JSON</div>';
  }

  App.exportCurrent = function () {
    if (!State.current) return;
    M.saveAudit(State.current);
    downloadJSON(State.current, M.exportFilename(State.current));
    toast("Exported " + M.exportFilename(State.current), "ok");
  };

  function renderCatNav() {
    var a = State.current;
    var lis = M.CHECKLIST.categories.map(function (cat) {
      var s = M.scoreCategory(a, cat);
      var dotCls = s.complete ? "dot done" : (s.answered > 0 ? "dot part" : "dot");
      var pct = s.na === s.total ? "N/A" : s.pct + "%";
      return '<li class="' + (cat.id === State.activeCat ? "active" : "") + '" onclick="App.selectCat(\'' + cat.id + '\')">' +
        '<span class="' + dotCls + '"></span>' +
        '<span class="num">' + esc(cat.number) + "</span>" +
        '<span class="grow">' + esc(cat.name) + "</span>" +
        '<span class="pct" style="color:' + (s.answered === 0 ? "var(--grey)" : (s.pass ? "var(--green)" : "var(--red)")) + '">' + pct + "</span>" +
      "</li>";
    }).join("");
    var ov = M.scoreOverall(a);
    document.getElementById("catNav").innerHTML =
      '<div style="padding:8px 8px 12px">' +
        '<div class="row between"><span class="small muted">Overall</span><b style="color:' + (ov.pass ? "var(--green)" : "var(--red)") + '">' + ov.pct + "%</b></div>" +
        '<div class="pbar ' + (ov.pass ? "green" : "red") + ' mt" style="margin-top:6px"><span style="width:' + ov.pct + '%"></span></div>' +
        '<div class="tiny muted mt" style="margin-top:6px">' + ov.answered + "/" + ov.total + " answered &middot; pass ≥ " + ov.threshold + "%</div>" +
      "</div>" +
      "<ul>" + lis + "</ul>";
  }

  App.selectCat = function (id) { State.activeCat = id; window.scrollTo(0, 0); renderCatNav(); renderCatPanel(); };

  // Compact category dropdown shown only on phones/tablets (see .mobile-cat-picker CSS).
  function mobileCatPicker(a, activeCat) {
    var ov = M.scoreOverall(a);
    var opts = M.CHECKLIST.categories.map(function (c) {
      var s = M.scoreCategory(a, c);
      var pct = s.na === s.total ? "N/A" : s.pct + "%";
      var mark = s.complete ? "✓ " : (s.answered > 0 ? "• " : " ");
      return '<option value="' + c.id + '"' + (c.id === activeCat.id ? " selected" : "") + ">" +
        mark + esc(c.number) + ". " + esc(c.name) + " — " + pct + "</option>";
    }).join("");
    return '<div class="card">' +
      '<div class="row between"><span class="small muted">Overall</span>' +
        '<b style="color:' + (ov.pass ? "var(--green)" : "var(--red)") + '">' + ov.pct + "%</b></div>" +
      '<div class="pbar ' + (ov.pass ? "green" : "red") + '" style="margin:6px 0 10px"><span style="width:' + ov.pct + '%"></span></div>' +
      '<select onchange="App.selectCat(this.value)" aria-label="Choose category">' + opts + "</select>" +
      '<div class="tiny muted" style="margin-top:6px">' + ov.answered + "/" + ov.total + " answered &middot; pass ≥ " + ov.threshold + "%</div>" +
    "</div>";
  }

  function renderCatPanel() {
    var a = State.current;
    var cat = M.findCategory(State.activeCat);
    var s = M.scoreCategory(a, cat);
    var idx = M.CHECKLIST.categories.indexOf(cat);
    var prev = M.CHECKLIST.categories[idx - 1], next = M.CHECKLIST.categories[idx + 1];

    var groups = [], cur = null;
    cat.questions.forEach(function (q) {
      if (!cur || cur.title !== (q.group || "")) { cur = { title: q.group || "", qs: [] }; groups.push(cur); }
      cur.qs.push(q);
    });
    var qhtml = groups.map(function (g) {
      return (g.title ? '<div class="qgroup-title">' + esc(g.title) + "</div>" : "") +
        g.qs.map(function (q) { return questionHTML(a, q); }).join("");
    }).join("");

    document.getElementById("catPanel").innerHTML =
      '<div class="mobile-cat-picker">' + mobileCatPicker(a, cat) + "</div>" +
      '<div class="card" id="catCard">' +
        '<div class="row between">' +
          "<div><h2 style=\"margin-bottom:2px\">" + esc(cat.number) + ". " + esc(cat.name) + "</h2>" +
          (cat.subtitle ? '<div class="tiny muted">' + esc(cat.subtitle) + "</div>" : "") +
          (cat.clonedFrom ? '<div class="tiny muted">Aisle checklist (based on ' + esc(cat.clonedFrom) + ")</div>" : "") + "</div>" +
          '<div style="text-align:right"><div class="big" style="font-size:1.4rem;font-weight:800;color:' +
            (s.answered === 0 ? "var(--grey)" : (s.pass ? "var(--green)" : "var(--red)")) + '">' +
            (s.na === s.total ? "N/A" : s.pct + "%") + "</div>" +
            '<div class="tiny muted">' + s.score + " / " + s.weight + " pts</div></div>" +
        "</div>" +
        '<div class="pbar ' + (s.pass ? "green" : (s.answered ? "red" : "")) + '" style="margin-top:10px"><span style="width:' + (s.na === s.total ? 100 : s.pct) + '%"></span></div>' +
      "</div>" +
      qhtml +
      '<div class="row between mt2 no-print">' +
        (prev ? '<button class="btn" onclick="App.selectCat(\'' + prev.id + '\')">← ' + esc(prev.name) + "</button>" : "<span></span>") +
        (next ? '<button class="btn primary" onclick="App.selectCat(\'' + next.id + '\')">' + esc(next.name) + " →</button>" : '<button class="btn green" onclick="App.go(\'summary\')">View summary →</button>') +
      "</div>";
  }

  function questionHTML(a, q) {
    var r = M.getResponse(a, q.id) || {};
    var isNA = !!r.na;
    var hasScore = typeof r.score === "number";
    var stateCls = isNA ? "na" : (hasScore ? (r.score < q.maxScore ? "failed" : "answered") : "");
    // score quick buttons: 0, mid values, full, N/A
    var vals = scoreOptions(q.maxScore);
    var btns = vals.map(function (v) {
      var cls = "sbtn" + (v === 0 ? " zero" : (v === q.maxScore ? " full" : "")) + (hasScore && !isNA && r.score === v ? " on" : "");
      return '<button class="' + cls + '" onclick="App.setScore(\'' + q.id + "'," + v + ')">' + v + "</button>";
    }).join("");
    return '<div class="question ' + stateCls + '" id="q_' + q.id + '">' +
      '<div class="qhead">' +
        '<span class="qref">' + esc(q.ref) + "</span>" +
        '<span class="qtext">' + esc(q.text) + "</span>" +
        '<span class="qmax">max ' + q.maxScore + "</span>" +
      "</div>" +
      (q.guidance ? '<span class="gtoggle" onclick="App.toggleGuidance(\'' + q.id + '\')">ⓘ Guidance</span>' +
        '<div class="guidance hidden" id="g_' + q.id + '">' + esc(q.guidance) + "</div>" : "") +
      '<div class="score-row">' +
        '<div class="score-btns">' + btns + "</div>" +
        '<input class="score-num" type="number" min="0" max="' + q.maxScore + '" step="1" placeholder="pts" ' +
          'value="' + (hasScore && !isNA ? r.score : "") + '" oninput="App.setScoreRaw(\'' + q.id + "'," + q.maxScore + ',this.value)">' +
        '<button class="sbtn na' + (isNA ? " on" : "") + '" onclick="App.toggleNA(\'' + q.id + '\')">N/A</button>' +
      "</div>" +
      '<div class="q-extra">' +
        '<textarea placeholder="Reason / finding (why this score)" oninput="App.setReason(\'' + q.id + '\',this.value)">' + esc(r.reason || "") + "</textarea>" +
        '<div class="photo-row">' +
          (r.photo ? '<img class="thumb" src="' + r.photo + '" alt="photo">' +
            '<button class="btn sm danger" onclick="App.removePhoto(\'' + q.id + '\')">Remove photo</button>' :
            '<label class="btn sm">📷 Add photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="App.addPhoto(\'' + q.id + '\',this)"></label>') +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function scoreOptions(max) {
    // build a compact set of quick values: 0, some steps, max
    var set = { 0: 1 };
    set[max] = 1;
    [1, 3, 5, 10].forEach(function (v) { if (v < max) set[v] = 1; });
    if (max > 5 && max !== 10) set[Math.round(max / 2)] = 1;
    return Object.keys(set).map(Number).sort(function (x, y) { return x - y; });
  }

  // ---- audit interactions ----
  function refreshQuestion(qid) {
    var a = State.current;
    var fq = M.findQuestion(qid);
    var el = document.getElementById("q_" + qid);
    if (el && fq) { el.outerHTML = questionHTML(a, fq.q); }
    renderCatNav();
    updateCatHeader();
    M.saveAudit(a);
  }
  function updateCatHeader() {
    // Update only the live bits in place (avoids re-rendering the panel and losing input focus).
    var a = State.current, cat = M.findCategory(State.activeCat), s = M.scoreCategory(a, cat);
    var card = document.getElementById("catCard");
    if (card) {
      var bigs = card.querySelector(".big");
      var bar = card.querySelector(".pbar span");
      if (bigs) { bigs.textContent = (s.na === s.total ? "N/A" : s.pct + "%"); bigs.style.color = s.answered === 0 ? "var(--grey)" : (s.pass ? "var(--green)" : "var(--red)"); }
      if (bar) { bar.style.width = (s.na === s.total ? 100 : s.pct) + "%"; }
    }
    // Keep the mobile picker's overall figure in sync too.
    var ov = M.scoreOverall(a);
    var picker = document.querySelector(".mobile-cat-picker");
    if (picker) {
      var ob = picker.querySelector("b");
      var obar = picker.querySelector(".pbar span");
      if (ob) { ob.textContent = ov.pct + "%"; ob.style.color = ov.pass ? "var(--green)" : "var(--red)"; }
      if (obar) { obar.style.width = ov.pct + "%"; }
    }
  }

  App.setScore = function (qid, val) { var fq = M.findQuestion(qid); M.setResponse(State.current, qid, { score: M.clamp(val, 0, fq.q.maxScore), na: false }); refreshQuestion(qid); };
  App.setScoreRaw = function (qid, max, raw) {
    if (raw === "") { M.setResponse(State.current, qid, { score: null }); }
    else { var v = M.clamp(parseInt(raw, 10) || 0, 0, max); M.setResponse(State.current, qid, { score: v, na: false }); }
    // light update (don't re-render whole node to preserve typing) — update classes + nav
    renderCatNav(); updateCatHeader(); M.saveAudit(State.current);
  };
  App.toggleNA = function (qid) {
    var cur = M.getResponse(State.current, qid) || {};
    M.setResponse(State.current, qid, { na: !cur.na, score: null });
    refreshQuestion(qid);
  };
  App.setReason = function (qid, val) { M.setResponse(State.current, qid, { reason: val }); renderCatNav(); M.saveAudit(State.current); };
  App.toggleGuidance = function (qid) { var g = document.getElementById("g_" + qid); if (g) g.classList.toggle("hidden"); };
  App.addPhoto = function (qid, input) {
    readPhoto(input.files[0], function (dataURL) {
      if (!dataURL) return;
      M.setResponse(State.current, qid, { photo: dataURL });
      refreshQuestion(qid); toast("Photo attached", "ok");
    });
  };
  App.removePhoto = function (qid) { M.setResponse(State.current, qid, { photo: null }); refreshQuestion(qid); };

  // ---------------- Summary Report ----------------
  function renderSummary() {
    if (!State.current) return App.go("dashboard");
    M.saveAudit(State.current);
    view.innerHTML = '<div class="tabs no-print">' + tabBar("summary") + "</div>" +
      '<div class="row between mb no-print"><h1>Summary Report</h1><button class="btn" onclick="window.print()">🖨 Print / PDF</button></div>' +
      R.summaryHTML(State.current);
  }

  // ---------------- Remediation (interactive) ----------------
  function renderRemediation() {
    if (!State.current) return App.go("dashboard");
    var a = State.current;
    var hasItems = a.remediation.items && a.remediation.items.length;
    var ov = M.scoreOverall(a);
    view.innerHTML = '<div class="tabs no-print">' + tabBar("remediation") + "</div>" +
      '<div class="row between mb no-print"><h1>Remediation</h1><div class="row">' +
        '<button class="btn" onclick="App.regenRemediation()">↻ ' + (hasItems ? "Re-scan findings" : "Generate from audit") + "</button>" +
        (hasItems ? '<button class="btn green" onclick="App.go(\'revisit\')">＋ Start revisit</button>' +
                    '<button class="btn" onclick="window.print()">🖨 Print / PDF</button>' : "") +
      "</div></div>" +
      (!hasItems
        ? '<div class="card"><p class="muted">The remediation report lists <b>every failed question</b> (answered, not N/A, scored below its maximum). ' +
          'Currently ' + (ov.answered ? "no items have been generated." : "the audit has no answers yet.") + '</p>' +
          '<button class="btn primary" onclick="App.regenRemediation()">Generate remediation report</button></div>'
        : renderRemInteractive(a));
  }

  App.regenRemediation = function () {
    var items = M.generateRemediation(State.current);
    M.saveAudit(State.current);
    toast(items.length + " findings identified", "ok");
    renderRemediation();
  };

  function renderRemInteractive(a) {
    var prog = M.remediationProgress(a);
    var items = a.remediation.items;
    var cards = items.map(function (it, i) {
      var st = M.currentStatus(a, it);
      var cur = M.currentScore(a, it);
      var hist = M.itemHistory(a, it);
      return '<div class="rem-item ' + R.sevClass(it.severity) + '">' +
        '<div class="rem-head">' +
          '<span class="idx">#' + (i + 1) + "</span>" +
          sevSelect(it) +
          R.statusBadge(st) +
          '<span class="grow"></span>' +
          '<span class="tiny muted mono">' + esc(it.category) + " &middot; " + esc(it.ref) + "</span>" +
        "</div>" +
        '<div class="rem-body">' +
          '<div style="font-weight:700">' + esc(it.question) + "</div>" +
          (it.group ? '<div class="tiny muted">' + esc(it.group) + "</div>" : "") +
          '<div class="kv">' +
            '<div class="k">Score at audit</div><div class="mono">' + it.auditScore + " / " + it.maxScore + "</div>" +
            (cur !== it.auditScore ? '<div class="k">Latest score</div><div class="mono">' + cur + " / " + it.maxScore + "</div>" : "") +
            (it.reason ? '<div class="k">Finding</div><div>' + esc(it.reason) + "</div>" : "") +
          "</div>" +
          (it.auditPhoto ? '<div class="mt"><img class="thumb" src="' + it.auditPhoto + '" alt="evidence"></div>' : "") +
          (hist.length ? histHTML(a, it, hist) : "") +
        "</div>" +
      "</div>";
    }).join("");
    return '<div class="card no-print"><div class="row between"><div>' +
        badge("critical", prog.sev.Critical.t + " Critical") + " " + badge("major", prog.sev.Major.t + " Major") + " " + badge("minor", prog.sev.Minor.t + " Minor") +
      '</div><div class="small muted">' + prog.total + " findings &middot; " + prog.fixed + " fixed, " + prog["in-progress"] + " in progress, " + prog.open + " open</div></div></div>" +
      cards;
  }

  function sevSelect(it) {
    var opts = M.severityLevels().map(function (s) {
      return '<option value="' + s + '"' + (s === it.severity ? " selected" : "") + ">" + s + "</option>";
    }).join("");
    return '<select style="width:auto;padding:3px 6px;font-size:.8rem" onchange="App.setSeverity(\'' + it.id + '\',this.value)">' + opts + "</select>";
  }
  App.setSeverity = function (itemId, sev) {
    var it = M.remItem(State.current, itemId); if (!it) return;
    it.severity = sev; M.saveAudit(State.current); renderRemediation();
  };

  function histHTML(a, it, hist) {
    var rows = hist.map(function (h) {
      return '<div class="h-entry">' + fmtDate(h.date) + " &middot; " + R.statusBadge(h.status || "open") +
        (typeof h.newScore === "number" ? ' <span class="mono">score ' + h.newScore + "/" + it.maxScore + "</span>" : "") +
        (h.auditorName ? ' <span class="muted">by ' + esc(h.auditorName) + "</span>" : "") +
        (h.note ? "<br><span class=\"muted\">" + esc(h.note) + "</span>" : "") +
        (h.photo ? '<br><img class="thumb" src="' + h.photo + '">' : "") + "</div>";
    }).join("");
    return '<div class="hist"><div class="tiny muted" style="font-weight:700;text-transform:uppercase">Revisit history</div>' + rows + "</div>";
  }

  // ---------------- Revisit ----------------
  function renderRevisit() {
    if (!State.current) return App.go("dashboard");
    var a = State.current;
    if (!a.remediation.items || !a.remediation.items.length) { toast("Generate remediation first", "err"); return App.go("remediation"); }
    // draft held on State until saved
    State.draftRevisit = State.draftRevisit || { date: M.todayISO(), auditorName: a.audit.auditorName || "", notes: "", updates: {} };
    var d = State.draftRevisit;
    var items = a.remediation.items;
    var cards = items.map(function (it, i) {
      var baseStatus = M.currentStatus(a, it);
      var u = d.updates[it.id] || {};
      var chosen = u.status || baseStatus;
      return '<div class="rem-item ' + R.sevClass(it.severity) + '">' +
        '<div class="rem-head"><span class="idx">#' + (i + 1) + "</span>" + badge(it.severity.toLowerCase(), it.severity) +
          '<span class="grow"></span><span class="tiny muted mono">' + esc(it.category) + " &middot; " + esc(it.ref) + "</span></div>" +
        '<div class="rem-body">' +
          '<div style="font-weight:700">' + esc(it.question) + "</div>" +
          (it.reason ? '<div class="tiny muted mt">Original finding: ' + esc(it.reason) + "</div>" : "") +
          '<div class="score-row" style="margin-top:10px">' +
            ["open", "in-progress", "fixed"].map(function (st) {
              var lbl = { open: "Open", "in-progress": "In progress", fixed: "Fixed" }[st];
              return '<button class="sbtn ' + (st === "fixed" ? "full" : st === "open" ? "zero" : "") + (chosen === st ? " on" : "") +
                '" style="min-width:auto" onclick="App.revStatus(\'' + it.id + "','" + st + '\')">' + lbl + "</button>";
            }).join("") +
            '<span class="small muted" style="margin-left:6px">New score:</span>' +
            '<input class="score-num" type="number" min="0" max="' + it.maxScore + '" placeholder="/' + it.maxScore + '" value="' +
              (typeof u.newScore === "number" ? u.newScore : "") + '" oninput="App.revScore(\'' + it.id + "'," + it.maxScore + ',this.value)">' +
          "</div>" +
          '<div class="q-extra">' +
            '<textarea placeholder="Note on remediation (optional)" oninput="App.revNote(\'' + it.id + '\',this.value)">' + esc(u.note || "") + "</textarea>" +
            '<div class="photo-row">' +
              (u.photo ? '<img class="thumb" src="' + u.photo + '"><button class="btn sm danger" onclick="App.revPhotoDel(\'' + it.id + '\')">Remove</button>'
                       : '<label class="btn sm">📷 Evidence of fix<input type="file" accept="image/*" capture="environment" style="display:none" onchange="App.revPhoto(\'' + it.id + '\',this)"></label>') +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
    }).join("");

    view.innerHTML = '<div class="tabs no-print">' + tabBar("remediation") + "</div>" +
      '<div class="row between mb"><h1>Revisit &amp; Reassessment</h1><button class="btn ghost" onclick="App.cancelRevisit()">Cancel</button></div>' +
      '<div class="card"><div class="form-grid">' +
        '<label class="field"><span>Revisit date</span><input type="date" id="rv_date" value="' + esc(d.date) + '" onchange="App.draftMeta(\'date\',this.value)"></label>' +
        '<label class="field"><span>Auditor</span><input type="text" id="rv_auditor" value="' + esc(d.auditorName) + '" oninput="App.draftMeta(\'auditorName\',this.value)"></label>' +
      "</div>" +
      '<label class="field"><span>Visit notes</span><textarea oninput="App.draftMeta(\'notes\',this.value)">' + esc(d.notes) + "</textarea></label>" +
      '<div class="small muted">Update each item\'s status. Recording a new score here is remediation evidence only — the original audit score is never changed.</div>' +
      "</div>" +
      cards +
      '<div class="row between mt2"><button class="btn ghost" onclick="App.cancelRevisit()">Cancel</button>' +
      '<button class="btn green" onclick="App.saveRevisit()">Save revisit</button></div>';
  }

  App.draftMeta = function (k, v) { State.draftRevisit[k] = v; };
  App.revStatus = function (id, st) { (State.draftRevisit.updates[id] = State.draftRevisit.updates[id] || {}).status = st; renderRevisit(); };
  App.revScore = function (id, max, raw) {
    var u = State.draftRevisit.updates[id] = State.draftRevisit.updates[id] || {};
    if (raw === "") delete u.newScore; else u.newScore = M.clamp(parseInt(raw, 10) || 0, 0, max);
  };
  App.revNote = function (id, v) { (State.draftRevisit.updates[id] = State.draftRevisit.updates[id] || {}).note = v; };
  App.revPhoto = function (id, input) {
    readPhoto(input.files[0], function (url) { if (!url) return; (State.draftRevisit.updates[id] = State.draftRevisit.updates[id] || {}).photo = url; renderRevisit(); });
  };
  App.revPhotoDel = function (id) { if (State.draftRevisit.updates[id]) delete State.draftRevisit.updates[id].photo; renderRevisit(); };
  App.cancelRevisit = function () { State.draftRevisit = null; App.go("remediation"); };
  App.saveRevisit = function () {
    var d = State.draftRevisit;
    var updates = {};
    Object.keys(d.updates).forEach(function (id) {
      var u = d.updates[id];
      if (u && (u.status || typeof u.newScore === "number" || u.note || u.photo)) updates[id] = u;
    });
    if (!Object.keys(updates).length) { toast("No changes recorded", "err"); return; }
    var rv = M.addRevisit(State.current, { date: d.date, auditorName: d.auditorName, notes: d.notes });
    rv.updates = updates;
    // propagate latest status onto the item.status so it persists as current baseline
    Object.keys(updates).forEach(function (id) {
      var it = M.remItem(State.current, id);
      if (it && updates[id].status) it.status = updates[id].status;
    });
    M.saveAudit(State.current);
    State.draftRevisit = null;
    toast("Revisit saved", "ok");
    App.go("progress");
  };

  // ---------------- Progress ----------------
  function renderProgress() {
    if (!State.current) return App.go("dashboard");
    view.innerHTML = '<div class="tabs no-print">' + tabBar("progress") + "</div>" +
      '<div class="row between mb no-print"><h1>Progress</h1><button class="btn" onclick="window.print()">🖨 Print / PDF</button></div>' +
      R.progressHTML(State.current);
  }

  // ---------------- boot ----------------
  if (!window.CHECKLIST || !window.CHECKLIST.categories) {
    view.innerHTML = '<div class="card"><h2>Checklist data failed to load</h2><p class="muted">js/checklist-data.js is missing.</p></div>';
  } else {
    App.go("dashboard");
  }
})();
