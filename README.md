# StoreAudit

A self-contained web app for retail store auditing, remediation planning, and
follow-up reassessment. Built for a field auditor who works through a large,
weighted checklist, presents category-level findings to the store owner, hands
over an actionable remediation report, and returns on later visits to record how
far the owner has progressed in fixing the delinquent findings.

The checklist is the **SPAR ROC National — Retail Operations Checklist**
(38 categories, 682 weighted questions), parsed from the source spreadsheet in
[`samples/`](samples/).

> **No install, no server, works offline.** It's plain HTML/CSS/JavaScript with
> the checklist data embedded. Open `index.html` in any modern browser, or host
> the folder on GitHub Pages.

> **Phone-friendly.** The layout is responsive: on a phone the category sidebar
> becomes a compact dropdown so questions are visible immediately, the tab bar
> scrolls sideways, and **📷 Add photo** opens the camera directly.
> <br><img src="docs/screenshots/phone-audit.png" alt="Phone view" width="240">

## Screenshots

| Audit | Summary report |
|---|---|
| ![Audit](docs/screenshots/audit.png) | ![Summary](docs/screenshots/summary-report.png) |

| Remediation | Progress |
|---|---|
| ![Remediation](docs/screenshots/remediation.png) | ![Progress](docs/screenshots/progress.png) |

## What it does

1. **Audit** — work category by category. Each question gets a score (0 up to its
   maximum), a reason, and an optional photo, or is marked **N/A**. Category and
   overall percentages update live against the **80% pass mark**.
2. **Summary report** — a category-level Pass/Fail table (Weight · Score · %),
   matching the SPAR summary format. Print or save to PDF from the browser.
3. **Remediation report** — automatically lists **every failed question**
   (answered, not N/A, below its maximum), each tagged **Minor / Major /
   Critical** and ordered Critical-first. Hand this to the store owner.
4. **Revisit & reassessment** — on a later visit, load the store's file and mark
   each item **Fixed / In progress / Open**, with an optional new score and photo
   as evidence. The original audit is never altered.
5. **Progress** — a before → after view: *problems found → fixed / in progress /
   open*, a completion bar, a severity breakdown, and a visit-by-visit history.

See [`docs/PROCESS.md`](docs/PROCESS.md) for the full workflow and the scoring /
weighting model, or [`docs/Process_Specification.docx`](docs/Process_Specification.docx)
for the formatted version.

## How weighting works

The **weight of a question is its maximum point value** — there is no separate
multiplier. A category's weight is the sum of its questions' maximum points; its
score is the sum of the points achieved; its result % is score ÷ weight. N/A
questions are excluded from both. The store passes at **80% overall**. This
reconciles exactly with the example summary report (Legal Compliance 63, Parking
23, Bakery 130, etc.).

## Data & storage

- Each audit is one **JSON file named `<Store>_<Date>.json`** (e.g.
  `SPAR_Turner_and_Haupt_2026-08-20.json`).
- **Export JSON** downloads that file; **Import JSON** loads it back on a revisit.
- The browser also keeps a working copy in `localStorage`, so audits survive a
  page reload on the same device. The exported file is the portable record to
  keep and to reopen on revisits.
- **Revisits are appended** to the same file (a dated list of status/score/photo
  updates per item), so one file tells the whole story of one audit and all its
  follow-ups. A new full audit starts a new file.

Photos are downscaled and embedded in the JSON as data URLs, so a file is fully
self-contained.

## Running it

**Locally:** open `index.html` in a browser (double-click, or `File → Open`).

**GitHub Pages:** enable Pages for this repo (Settings → Pages → deploy from the
branch's root). The app is fully static; a `.nojekyll` file is included.

## Project structure

```
index.html                 App shell
css/styles.css             Styles (responsive, print-friendly)
js/checklist-data.js       Embedded checklist (generated) — window.CHECKLIST
js/model.js                Data model, persistence, scoring, remediation logic
js/reports.js              Printable report renderers (summary, remediation, progress)
js/app.js                  Views, router, audit/remediation/revisit interactions
data/questions.json        Master question set (human-readable source of truth)
tools/build_questions.py   Regenerates data/questions.json + js/checklist-data.js
samples/                   Source SPAR checklist (.xlsx) + example summary report (.pdf)
docs/                      Process spec (Markdown + Word) and screenshots
```

## Regenerating the checklist data

If the source spreadsheet changes, rebuild the data files:

```bash
python3 tools/build_questions.py      # needs: pip install openpyxl
```

This reads `samples/ROC_National_Checklist.xlsx` and rewrites both
`data/questions.json` and `js/checklist-data.js`.

### A note on the aisle departments

The spreadsheet defines one "Dry Goods" shop-floor aisle as a template. The SPAR
summary report audits each grocery aisle separately (Breakfast, Main Meals, Home
Care, Pet Care, General Merchandise, Personal Care, Baby, Snacking, Health,
Bulk), each at the same weight. The build script therefore **clones the Dry Goods
question set** for those departments so the app reproduces the report faithfully.
Any that don't apply to a given store can simply be marked N/A. Edit the
`CLONE_DEPTS` list in `tools/build_questions.py` to change them.
