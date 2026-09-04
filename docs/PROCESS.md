# Retail Store Audit & Remediation — Process

The app supports **two audits, chosen by store type**, and the new 0–3 weighted
scoring with rating bands. (A formatted version is in
`docs/Workflow_ROC_RTTT.docx`.)

## The two audits

| Audit | Store types | Questions | Sections |
|---|---|---|---|
| **ROC** | SUPERSPAR · SPAR · SAVEMOR | 82 | 13 |
| **RTTT** | TOPS | 53 | 9 |

The auditor picks the store type when starting an audit; the app then loads only
that audit's questions.

## How scoring works

- Every question is scored **0–3** (0 = not met, 3 = fully met), or marked **N/A**
  to exclude it.
- Each question has a **Weight (%)** and a built-in **severity** — Critical,
  Major or Partial.
- **Section % and overall %** = Σ(score ÷ 3 × weight) ÷ Σ(weight). N/A questions
  are excluded from both.
- The store **passes at 80%**, and the overall % is also graded into a
  **rating band**:

| Score | Rating |
|---|---|
| 95–100% | Platinum |
| 90–94% | Gold |
| 80–89% | Silver |
| 70–79% | Bronze |
| Below 70% | Improvement Required |

## Phase 1 — The Audit (first visit)

1. **Choose the store type / audit** — e.g. TOPS → RTTT, or a SPAR supermarket →
   ROC. The app loads that audit's questions.
2. Enter the store details (name, ID, date, auditor, responsible person).
3. Work through each section, scoring every question **0–3**, or marking N/A.
4. Record a **reason** for each score, and optionally a **photo** as evidence.
5. The app calculates each section's weighted %, the overall %, the **pass/fail**
   (80%), and the **rating band**.
6. Generate the **summary report** — section-level results + overall rating.
   Print or save as PDF.
7. Save the audit as a **`<Store>_<Date>.json`** file (a frozen record).

## Phase 2 — Remediation plan

8. The app pulls out every **Critical or Major** question scored below full marks
   (Partial findings are not chased). Each becomes a remediation action item with
   its built-in severity, ordered Critical first.
9. Generate the **remediation report** and hand it to the store owner.

## Phase 3 — Revisit & reassessment

10. On a return visit, reload the store's JSON and open its outstanding items.
11. Mark each item **Fixed / In progress / Open**, with an optional new score and
    photo. *The new score is remediation evidence only — the original audit is
    never changed.*
12. The revisit is appended (dated) to the same file, preserving history.
13. The **progress** view shows found N problems → X fixed / Y in progress / Z
    open, per revisit, with a severity breakdown. A new full audit starts a new
    file.

## Confirmed decisions

- **Store type → audit:** TOPS → RTTT; SUPERSPAR / SPAR / SAVEMOR → ROC.
- **Score formula:** overall % = Σ(score ÷ 3 × weight) ÷ Σ(weight).
- **80% pass line** stays, shown alongside the rating band.
- **Remediation** lists **Critical and Major** findings only (Partial excluded);
  severity comes from the question, not the auditor.
