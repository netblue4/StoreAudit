# Retail Store Audit & Remediation — Process

This is the workflow the app implements. (A formatted Word version is in
`docs/Process_Specification.docx`.)

## How scoring works

Weighting is **not** a separate multiplier — the **weight of a question is its
maximum point value**. More important questions are worth more points, and
everything rolls up by addition.

- **Question** — each question has a maximum score, its weight (typically 1, 3,
  5 or 10). Most are all-or-nothing: the store gets the full points or 0. Award
  a partial value where appropriate.
- **Category** — weight = sum of its questions' max points; score = sum of
  achieved points; result % = score ÷ weight.
- **Overall** — the store passes at **80%** overall (total score ÷ total weight).
- **N/A** — a question can be marked N/A (e.g. the store has no flags); N/A
  questions count toward neither weight nor score.

*A question's weight = its maximum points; a category's weight = the sum of its
questions' maximum points; the score % = points achieved ÷ points available; and
the store passes at 80% overall.*

## Phase 1 — The Audit (first visit)

1. Load the master question set (categories → questions, each with its weight
   and evaluation criteria).
2. Work through every category, asking each question.
3. Award each question an **achieved score** (0 up to its max), or mark it **N/A**.
4. Record a short **reason / comment** for each finding.
5. Optionally attach a **photo** as evidence.
6. The app auto-calculates each category's score, weight and %, and the overall %
   against the 80% pass mark.
7. Generate the **summary report** — **category-level only** (each category's %,
   weight, score; overall Pass/Fail). Individual questions are not listed here.
8. Save the whole audit to a JSON file named **`<Store>_<Date>.json`** — a frozen
   record that is never overwritten.

## Phase 2 — Remediation plan (new addition)

9. The app pulls out **every failed question** (answered, not N/A, scored below
   its maximum), across all categories.
10. Each becomes a **remediation action item** carrying: the question, its
    category, achieved vs max score, the reason, the photo, a **severity
    (Minor / Major / Critical)**, and a status starting at **Open**.
11. Generate the **remediation report**, ordered so **Critical** items come
    first, and hand it to the store owner.

## Phase 3 — Revisit & reassessment (new addition)

12. On a return visit, the app **loads the store's JSON** and opens its
    outstanding remediation items.
13. For each item the auditor sets a status — **Fixed / In progress / Open** —
    and may record a **new score** as proof of improvement. *This new score is
    remediation evidence only; the original audit score is never changed.*
14. Optionally attach a **photo** of the correction.
15. The revisit is **appended (dated) to the same JSON file**, preserving full
    history.
16. The app shows the **progress flow**: *found N problems → X fixed / Y in
    progress / Z open*, per revisit, with a severity breakdown.
17. When all items are Fixed, that audit's remediation cycle is complete. A
    future full audit starts a **new JSON file**, and the store's audit history
    grows over time.

## Confirmed decisions

- **Delinquent rule:** every failed question becomes a remediation item (matching
  how the current SPAR report behaves), not only questions in failed categories.
- **Severity:** each remediation item carries a Minor / Major / Critical tag so
  the owner fixes the most serious items first.
- **Revisit re-score:** a follow-up score is stored as remediation evidence only —
  the original audit record stays untouched, preserving the before-and-after
  picture.
