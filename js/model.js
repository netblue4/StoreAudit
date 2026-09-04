/* model.js — data model, persistence, scoring, remediation.
   Supports two audit sets (ROC, RTTT) chosen by store type. Questions are scored
   0..maxScore (3), each with a Weight (%) and a built-in severity. Result % is the
   weighted average: sum(score/max * weight) / sum(weight). Pass at 80%.
   All state is plain JSON so it round-trips through the exported <Store>_<Date>.json. */
(function () {
  "use strict";

  var LS_KEY = "storeaudit:audits:v2";
  var SCHEMA_VERSION = 2;

  function slug(s) {
    return String(s || "").trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").replace(/_+/g, "_") || "Store";
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function uid() { return "id-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }

  var CHECKLIST = window.CHECKLIST || { meta: {}, storeTypes: [], audits: {} };
  function meta() { return CHECKLIST.meta || {}; }
  function passThreshold() { return meta().passThresholdPct || 80; }
  function scoreMax() { return meta().scoreMax || 3; }
  function severityLevels() { return meta().severityLevels || ["Critical", "Major", "Partial"]; }
  function remediationSeverities() { return meta().remediationSeverities || ["Critical", "Major"]; }
  function ratingBands() { return meta().ratingBands || []; }
  function storeTypes() { return CHECKLIST.storeTypes || []; }

  function auditForStoreType(label) {
    var st = storeTypes().filter(function (s) { return s.label === label; })[0];
    return st ? st.audit : null;
  }
  function ratingBand(pct) {
    var b = ratingBands().filter(function (x) { return pct >= x.min && pct <= x.max; })[0];
    return b ? b.label : "";
  }

  // --- audit-set resolution (which question set an audit uses) ---
  function auditSet(audit) {
    var id = audit && audit.auditType;
    return id && CHECKLIST.audits[id] ? CHECKLIST.audits[id] : null;
  }
  function categoriesOf(audit) { var s = auditSet(audit); return s ? s.categories : []; }
  function findCategory(audit, id) { return categoriesOf(audit).filter(function (c) { return c.id === id; })[0]; }
  function findQuestion(audit, qid) {
    var r = null;
    categoriesOf(audit).forEach(function (c) { c.questions.forEach(function (q) { if (q.id === qid) r = { cat: c, q: q }; }); });
    return r;
  }

  // ---------- audit factory ----------
  function newAudit(store) {
    var auditType = store.auditType || auditForStoreType(store.storeType) || "ROC";
    var set = CHECKLIST.audits[auditType];
    return {
      schemaVersion: SCHEMA_VERSION,
      id: slug(store.name) + "_" + (store.date || todayISO()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditType: auditType,
      auditName: set ? set.name : auditType,
      checklist: { title: meta().title, version: meta().version, passThresholdPct: passThreshold() },
      store: {
        name: store.name || "", siteId: store.siteId || "", address: store.address || "",
        responsiblePerson: store.responsiblePerson || "", storeType: store.storeType || ""
      },
      audit: {
        date: store.date || todayISO(), auditorName: store.auditorName || "",
        whoAccompanied: store.whoAccompanied || "", responses: {}
      },
      remediation: { generatedAt: null, items: [] },
      revisits: []
    };
  }

  // ---------- responses ----------
  function getResponse(audit, qid) { return audit.audit.responses[qid] || null; }
  function setResponse(audit, qid, patch) {
    var r = audit.audit.responses[qid] || { score: null, na: false, reason: "", photo: null };
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    if (r.score === null && !r.na && !r.reason && !r.photo) delete audit.audit.responses[qid];
    else audit.audit.responses[qid] = r;
    audit.updatedAt = new Date().toISOString();
  }

  // ---------- scoring (0..max, weighted) ----------
  // weight = sum of question weights (N/A excluded). score = sum(frac * weight) where
  // frac = achieved/max. Unanswered questions keep their weight but contribute 0.
  function scoreCategory(audit, cat) {
    var max = scoreMax(), weight = 0, achieved = 0, answered = 0, na = 0, failed = 0, total = cat.questions.length;
    cat.questions.forEach(function (q) {
      var r = getResponse(audit, q.id);
      var qmax = q.maxScore || max;
      if (r && r.na) { na++; answered++; return; }
      weight += q.weight;
      if (r && typeof r.score === "number") {
        answered++;
        achieved += (clamp(r.score, 0, qmax) / qmax) * q.weight;
        if (r.score < qmax) failed++;
      }
    });
    var pct = weight > 0 ? round((achieved / weight) * 100, 0) : (na === total ? 100 : 0);
    return {
      weight: weight, score: round(achieved, 0), achieved: achieved, pct: pct,
      answered: answered, na: na, total: total, failed: failed,
      complete: answered >= total, pass: pct >= passThreshold()
    };
  }

  function scoreOverall(audit) {
    var weight = 0, achieved = 0, answered = 0, total = 0;
    categoriesOf(audit).forEach(function (cat) {
      var s = scoreCategory(audit, cat);
      weight += s.weight; achieved += s.achieved; answered += s.answered; total += s.total;
    });
    var pct = weight > 0 ? round((achieved / weight) * 100, 0) : 0;
    return {
      weight: round(weight, 0), score: round(achieved, 0), pct: pct,
      answered: answered, total: total, complete: answered >= total,
      pass: pct >= passThreshold(), threshold: passThreshold(), band: ratingBand(pct)
    };
  }

  // ---------- remediation ----------
  // A remediation item is created for every failed question (answered, not N/A,
  // score < max) whose built-in severity is in remediationSeverities (Critical/Major).
  // Severity comes from the question, not the auditor. Re-generating preserves
  // status/history for items that still exist.
  function generateRemediation(audit) {
    var prev = {};
    (audit.remediation.items || []).forEach(function (it) { prev[it.questionId] = it; });
    var keep = remediationSeverities();
    var items = [];
    categoriesOf(audit).forEach(function (cat) {
      cat.questions.forEach(function (q) {
        var r = getResponse(audit, q.id);
        if (!r || r.na || typeof r.score !== "number") return;
        var qmax = q.maxScore || scoreMax();
        if (r.score >= qmax) return;                       // fully met
        if (keep.indexOf(q.severity) < 0) return;          // Partial etc. excluded
        var old = prev[q.id];
        items.push({
          id: old ? old.id : uid(),
          questionId: q.id, categoryId: cat.id, category: cat.name,
          group: q.group || "", ref: q.ref, question: q.text, guidance: q.guidance || "",
          maxScore: qmax, auditScore: r.score, reason: r.reason || "", auditPhoto: r.photo || null,
          weight: q.weight, severity: q.severity,
          status: old ? old.status : "open",
          createdDate: old ? old.createdDate : audit.audit.date
        });
      });
    });
    var order = { Critical: 0, Major: 1, Partial: 2 };
    items.sort(function (a, b) {
      var s = (order[a.severity] == null ? 9 : order[a.severity]) - (order[b.severity] == null ? 9 : order[b.severity]);
      return s !== 0 ? s : a.category.localeCompare(b.category);
    });
    audit.remediation.items = items;
    audit.remediation.generatedAt = new Date().toISOString();
    audit.updatedAt = new Date().toISOString();
    return items;
  }

  function remItem(audit, itemId) { return (audit.remediation.items || []).filter(function (i) { return i.id === itemId; })[0]; }
  function currentStatus(audit, item) {
    var st = item.status || "open";
    (audit.revisits || []).forEach(function (rv) { var u = rv.updates && rv.updates[item.id]; if (u && u.status) st = u.status; });
    return st;
  }
  function currentScore(audit, item) {
    var sc = item.auditScore;
    (audit.revisits || []).forEach(function (rv) { var u = rv.updates && rv.updates[item.id]; if (u && typeof u.newScore === "number") sc = u.newScore; });
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
    var counts = { total: items.length, open: 0, "in-progress": 0, fixed: 0, sev: {} };
    severityLevels().forEach(function (s) { counts.sev[s] = { t: 0, fixed: 0 }; });
    items.forEach(function (it) {
      var st = currentStatus(audit, it);
      counts[st] = (counts[st] || 0) + 1;
      var sv = counts.sev[it.severity] || (counts.sev[it.severity] = { t: 0, fixed: 0 });
      sv.t++; if (st === "fixed") sv.fixed++;
    });
    counts.pctFixed = items.length ? round((counts.fixed / items.length) * 100, 0) : 0;
    return counts;
  }
  function addRevisit(audit, m) {
    var rv = { id: uid(), date: m.date || todayISO(), auditorName: m.auditorName || "", notes: m.notes || "", updates: {} };
    audit.revisits.push(rv); audit.updatedAt = new Date().toISOString();
    return rv;
  }

  // ---------- persistence ----------
  function loadIndex() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function saveIndex(idx) { try { localStorage.setItem(LS_KEY, JSON.stringify(idx)); return true; } catch (e) { console.warn("save failed", e); return false; } }
  function saveAudit(audit) { audit.updatedAt = new Date().toISOString(); var idx = loadIndex(); idx[audit.id] = audit; return saveIndex(idx); }
  function listAudits() {
    var idx = loadIndex();
    return Object.keys(idx).map(function (k) { return idx[k]; })
      .sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); });
  }
  function getAudit(id) { return loadIndex()[id] || null; }
  function deleteAudit(id) { var idx = loadIndex(); delete idx[id]; saveIndex(idx); }
  function importAudit(obj) {
    if (!obj || !obj.store || !obj.audit) throw new Error("Not a valid StoreAudit file.");
    if (!obj.auditType) throw new Error("This file was made with an older version and has no audit type.");
    if (!CHECKLIST.audits[obj.auditType]) throw new Error("Unknown audit type: " + obj.auditType);
    if (!obj.id) obj.id = slug(obj.store.name) + "_" + (obj.audit.date || todayISO());
    if (!obj.remediation) obj.remediation = { generatedAt: null, items: [] };
    if (!obj.revisits) obj.revisits = [];
    saveAudit(obj);
    return obj;
  }
  function exportFilename(audit) { return slug(audit.store.name) + "_" + (audit.audit.date || todayISO()) + ".json"; }

  window.Model = {
    CHECKLIST: CHECKLIST, meta: meta, passThreshold: passThreshold, scoreMax: scoreMax,
    severityLevels: severityLevels, remediationSeverities: remediationSeverities,
    ratingBands: ratingBands, ratingBand: ratingBand, storeTypes: storeTypes, auditForStoreType: auditForStoreType,
    auditSet: auditSet, categoriesOf: categoriesOf, findCategory: findCategory, findQuestion: findQuestion,
    newAudit: newAudit, getResponse: getResponse, setResponse: setResponse,
    scoreCategory: scoreCategory, scoreOverall: scoreOverall,
    generateRemediation: generateRemediation, remItem: remItem,
    currentStatus: currentStatus, currentScore: currentScore, itemHistory: itemHistory,
    remediationProgress: remediationProgress, addRevisit: addRevisit,
    saveAudit: saveAudit, listAudits: listAudits, getAudit: getAudit, deleteAudit: deleteAudit,
    importAudit: importAudit, exportFilename: exportFilename,
    slug: slug, todayISO: todayISO, uid: uid, clamp: clamp, round: round
  };
})();
