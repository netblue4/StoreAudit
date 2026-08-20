/* model.js — data model, persistence, scoring, remediation.
   All state is plain JSON so it round-trips through the exported <Store>_<Date>.json file. */
(function () {
  "use strict";

  var LS_KEY = "storeaudit:audits:v1";
  var SCHEMA_VERSION = 1;

  // ---------- small helpers ----------
  function slug(s) {
    return String(s || "").trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").replace(/_+/g, "_") || "Store";
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function uid() { return "id-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }

  // ---------- checklist accessors ----------
  var CHECKLIST = window.CHECKLIST || { meta: {}, categories: [] };
  function passThreshold() { return (CHECKLIST.meta && CHECKLIST.meta.passThresholdPct) || 80; }
  function severityLevels() { return (CHECKLIST.meta && CHECKLIST.meta.severityLevels) || ["Minor", "Major", "Critical"]; }
  function allQuestions() {
    var out = [];
    CHECKLIST.categories.forEach(function (c) {
      c.questions.forEach(function (q) { out.push({ cat: c, q: q }); });
    });
    return out;
  }
  function findCategory(id) { return CHECKLIST.categories.filter(function (c) { return c.id === id; })[0]; }
  function findQuestion(qid) {
    var r = null;
    CHECKLIST.categories.forEach(function (c) {
      c.questions.forEach(function (q) { if (q.id === qid) r = { cat: c, q: q }; });
    });
    return r;
  }

  // ---------- audit factory ----------
  function newAudit(store) {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: slug(store.name) + "_" + (store.date || todayISO()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checklist: {
        title: CHECKLIST.meta.title,
        version: CHECKLIST.meta.version,
        passThresholdPct: passThreshold()
      },
      store: {
        name: store.name || "",
        siteId: store.siteId || "",
        address: store.address || "",
        responsiblePerson: store.responsiblePerson || ""
      },
      audit: {
        date: store.date || todayISO(),
        auditorName: store.auditorName || "",
        whoAccompanied: store.whoAccompanied || "",
        responses: {}   // questionId -> {score, na, reason, photo}
      },
      remediation: { generatedAt: null, items: [] },
      revisits: []       // [{id,date,auditorName,notes,updates:{itemId:{status,newScore,photo,note}}}]
    };
  }

  // ---------- response helpers ----------
  function getResponse(audit, qid) {
    return audit.audit.responses[qid] || null;
  }
  function setResponse(audit, qid, patch) {
    var r = audit.audit.responses[qid] || { score: null, na: false, reason: "", photo: null };
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    // Clean empty responses to keep the file lean
    if (r.score === null && !r.na && !r.reason && !r.photo) {
      delete audit.audit.responses[qid];
    } else {
      audit.audit.responses[qid] = r;
    }
    audit.updatedAt = new Date().toISOString();
  }

  // ---------- scoring ----------
  // For a category: weight = sum of maxScore for non-N/A answered-or-unanswered questions.
  // N/A questions are excluded from weight and score. Unanswered questions count toward
  // weight (max) but contribute 0 score, so an incomplete audit shows realistic %.
  function scoreCategory(audit, cat) {
    var weight = 0, score = 0, answered = 0, na = 0, failed = 0, total = cat.questions.length;
    cat.questions.forEach(function (q) {
      var r = getResponse(audit, q.id);
      if (r && r.na) { na++; answered++; return; }               // excluded entirely
      weight += q.maxScore;
      if (r && typeof r.score === "number") {
        answered++;
        score += clamp(r.score, 0, q.maxScore);
        if (r.score < q.maxScore) failed++;
      }
    });
    var pct = weight > 0 ? round((score / weight) * 100, 0) : (na === total ? 100 : 0);
    return {
      weight: weight, score: score, pct: pct,
      answered: answered, na: na, total: total, failed: failed,
      complete: answered >= total,
      pass: pct >= passThreshold()
    };
  }

  function scoreOverall(audit) {
    var weight = 0, score = 0, answered = 0, total = 0;
    CHECKLIST.categories.forEach(function (cat) {
      if (cat.bonus) return; // bonus excluded from the pass calc (matches SPAR: bonus is extra)
      var s = scoreCategory(audit, cat);
      weight += s.weight; score += s.score; answered += s.answered; total += s.total;
    });
    var pct = weight > 0 ? round((score / weight) * 100, 0) : 0;
    return {
      weight: weight, score: score, pct: pct,
      answered: answered, total: total,
      complete: answered >= total,
      pass: pct >= passThreshold(),
      threshold: passThreshold()
    };
  }

  // ---------- remediation ----------
  // A remediation item is created for EVERY failed question (answered, not N/A, score < max),
  // across all categories (per confirmed spec). Severity defaults to "Major"; auditor edits it.
  // Re-generating preserves severity/status/history for items that still exist.
  function guessSeverity(q, r) {
    // sensible default: bigger-weighted misses skew Major/Critical, small ones Minor
    if (q.maxScore >= 10) return "Major";
    if (q.maxScore <= 1) return "Minor";
    return "Major";
  }

  function generateRemediation(audit) {
    var prev = {};
    (audit.remediation.items || []).forEach(function (it) { prev[it.questionId] = it; });
    var items = [];
    CHECKLIST.categories.forEach(function (cat) {
      cat.questions.forEach(function (q) {
        var r = getResponse(audit, q.id);
        if (!r || r.na) return;
        if (typeof r.score !== "number") return;
        if (r.score >= q.maxScore) return; // passed this question
        var old = prev[q.id];
        items.push({
          id: old ? old.id : uid(),
          questionId: q.id,
          categoryId: cat.id,
          category: cat.name,
          group: q.group || "",
          ref: q.ref,
          question: q.text,
          guidance: q.guidance || "",
          maxScore: q.maxScore,
          auditScore: r.score,
          reason: r.reason || "",
          auditPhoto: r.photo || null,
          severity: old ? old.severity : guessSeverity(q, r),
          status: old ? old.status : "open",
          createdDate: old ? old.createdDate : audit.audit.date
        });
      });
    });
    // severity order for display
    var order = { Critical: 0, Major: 1, Minor: 2 };
    items.sort(function (a, b) {
      var s = (order[a.severity] || 9) - (order[b.severity] || 9);
      if (s !== 0) return s;
      return a.category.localeCompare(b.category);
    });
    audit.remediation.items = items;
    audit.remediation.generatedAt = new Date().toISOString();
    audit.updatedAt = new Date().toISOString();
    return items;
  }

  function remItem(audit, itemId) {
    return (audit.remediation.items || []).filter(function (i) { return i.id === itemId; })[0];
  }

  // current status of an item = latest revisit update if any, else item.status
  function currentStatus(audit, item) {
    var st = item.status || "open";
    (audit.revisits || []).forEach(function (rv) {
      var u = rv.updates && rv.updates[item.id];
      if (u && u.status) st = u.status;
    });
    return st;
  }
  function currentScore(audit, item) {
    var sc = item.auditScore;
    (audit.revisits || []).forEach(function (rv) {
      var u = rv.updates && rv.updates[item.id];
      if (u && typeof u.newScore === "number") sc = u.newScore;
    });
    return sc;
  }
  function itemHistory(audit, item) {
    var h = [];
    (audit.revisits || []).forEach(function (rv) {
      var u = rv.updates && rv.updates[item.id];
      if (u) h.push({ date: rv.date, auditorName: rv.auditorName, status: u.status, newScore: u.newScore, photo: u.photo, note: u.note });
    });
    return h;
  }

  function remediationProgress(audit) {
    var items = audit.remediation.items || [];
    var counts = { total: items.length, open: 0, "in-progress": 0, fixed: 0,
                   sev: { Critical: { t: 0, fixed: 0 }, Major: { t: 0, fixed: 0 }, Minor: { t: 0, fixed: 0 } } };
    items.forEach(function (it) {
      var st = currentStatus(audit, it);
      counts[st] = (counts[st] || 0) + 1;
      var sv = counts.sev[it.severity] || (counts.sev[it.severity] = { t: 0, fixed: 0 });
      sv.t++;
      if (st === "fixed") sv.fixed++;
    });
    counts.pctFixed = items.length ? round((counts.fixed / items.length) * 100, 0) : 0;
    return counts;
  }

  function addRevisit(audit, meta) {
    var rv = { id: uid(), date: meta.date || todayISO(), auditorName: meta.auditorName || "", notes: meta.notes || "", updates: {} };
    audit.revisits.push(rv);
    audit.updatedAt = new Date().toISOString();
    return rv;
  }

  // ---------- persistence (localStorage index) ----------
  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveIndex(idx) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(idx)); return true; }
    catch (e) { console.warn("localStorage save failed", e); return false; }
  }
  function saveAudit(audit) {
    audit.updatedAt = new Date().toISOString();
    var idx = loadIndex();
    idx[audit.id] = audit;
    return saveIndex(idx);
  }
  function listAudits() {
    var idx = loadIndex();
    return Object.keys(idx).map(function (k) { return idx[k]; })
      .sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); });
  }
  function getAudit(id) { return loadIndex()[id] || null; }
  function deleteAudit(id) { var idx = loadIndex(); delete idx[id]; saveIndex(idx); }

  // import a full audit object (from an uploaded JSON file); assigns/keeps id
  function importAudit(obj) {
    if (!obj || !obj.store || !obj.audit) throw new Error("Not a valid StoreAudit file.");
    if (!obj.id) obj.id = slug(obj.store.name) + "_" + (obj.audit.date || todayISO());
    if (!obj.remediation) obj.remediation = { generatedAt: null, items: [] };
    if (!obj.revisits) obj.revisits = [];
    saveAudit(obj);
    return obj;
  }

  function exportFilename(audit) {
    return slug(audit.store.name) + "_" + (audit.audit.date || todayISO()) + ".json";
  }

  // ---------- expose ----------
  window.Model = {
    CHECKLIST: CHECKLIST,
    passThreshold: passThreshold,
    severityLevels: severityLevels,
    allQuestions: allQuestions,
    findCategory: findCategory,
    findQuestion: findQuestion,
    newAudit: newAudit,
    getResponse: getResponse,
    setResponse: setResponse,
    scoreCategory: scoreCategory,
    scoreOverall: scoreOverall,
    generateRemediation: generateRemediation,
    remItem: remItem,
    currentStatus: currentStatus,
    currentScore: currentScore,
    itemHistory: itemHistory,
    remediationProgress: remediationProgress,
    addRevisit: addRevisit,
    saveAudit: saveAudit,
    listAudits: listAudits,
    getAudit: getAudit,
    deleteAudit: deleteAudit,
    importAudit: importAudit,
    exportFilename: exportFilename,
    // utils
    slug: slug, todayISO: todayISO, uid: uid, clamp: clamp, round: round
  };
})();
