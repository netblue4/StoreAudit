#!/usr/bin/env python3
"""Build data/questions.json and js/checklist-data.js from the source ROC checklist.

Usage:  python3 tools/build_questions.py
Reads:  samples/ROC_National_Checklist.xlsx
Writes: data/questions.json  and  js/checklist-data.js
"""
import openpyxl, json, re, copy, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "ROC_National_Checklist.xlsx")
wb = openpyxl.load_workbook(SRC, data_only=False)
ws = wb["ROC NATIONAL"]

def cell(r, c):
    v = ws.cell(r, c).value
    if isinstance(v, str):
        v = v.strip()
        if v == "":
            return None
    return v

# Category header rows (col A integer 1..27, B/C/D empty) + bonus
CAT_ROWS = [4,26,42,50,69,99,108,129,144,176,185,196,233,278,317,353,379,406,443,482,517,550,587,613,623,670,679]
BONUS_ROW = 697
END = 700

# Clean display names per category number (aligned to the SPAR summary report labels)
NAMES = {
 1:"Store - Legal Compliance",
 2:"Parking Area",
 3:"Exterior - Building",
 4:"Store Exterior & Brand Specification",
 5:"Store Entrance Brand Specification",
 6:"Store Entrance - Parcel Counter",
 7:"Interior Brand Specification",
 8:"Interior - Branded Payzone - KIOSK",
 9:"Interior Front End",
 10:"Interior Shop Floor - Aisle Blades",
 11:"Interior Shop Floor - Impulse Stands",
 12:"Dry Goods - Shop Floor",
 13:"Wine - Shop Floor",
 14:"Water & Cold Refreshment Fridges - Shop Floor",
 15:"Perishables - Shop Floor",
 16:"Frozens - Shop Floor",
 17:"Promotional Execution - Front & Back Gondola Ends",
 18:"Produce - Front of House",
 19:"Bakery - Front of House",
 20:"Butchery - Front of House",
 21:"H.M.R. Deli - Front of House",
 22:"Chikka Chicken - Front of House",
 23:"Bean Tree - Front of House",
 24:"Interior - Staff Canteen",
 25:"Back Up Areas - Store Room - Receiving",
 26:"Management - Shop Floor",
 27:"National Focuses - E-Learning",
}

def collect_subtitle(start):
    """The ALL-CAPS descriptor line(s) beneath a category header."""
    parts = []
    for r in range(start+1, start+4):
        a = cell(r,1); b = cell(r,2)
        for v in (a,b):
            if isinstance(v,str):
                u = v.strip()
                if not u or u.upper() == "CRITERIA":
                    continue
                # skip if it's the same as clean name source words only
                parts.append(u)
    # de-dupe preserving order
    seen=set(); out=[]
    for p in parts:
        if p not in seen:
            seen.add(p); out.append(p)
    return out

def is_group_header(r):
    """A subsection/group header: has text in B and C is empty or a formula (not a number)."""
    b = cell(r,2); c = ws.cell(r,3).value
    if b is None: return False
    if isinstance(c,(int,float)): return False
    return True  # text present, no numeric score

def parse_category(num, start, end):
    subtitle = collect_subtitle(start)
    questions = []
    current_group = None
    qidx = 0
    for r in range(start+1, end):
        a = cell(r,1); b = cell(r,2); c = ws.cell(r,3).value; d = cell(r,4)
        # skip pure "CRITERIA" label rows and empty rows
        if b is not None and isinstance(b,str) and b.strip().upper()=="CRITERIA":
            continue
        if isinstance(c,(int,float)):
            # leaf question
            qidx += 1
            ref = str(a).strip() if a is not None else str(qidx)
            grp = current_group
            # If the leaf itself carries a section number (e.g. 12.1) and no group yet, group under category walk line
            questions.append({
                "id": f"c{num}-q{qidx}",
                "ref": ref,
                "group": grp,
                "text": b if b else "",
                "maxScore": c,
                "guidance": d if d else ""
            })
        else:
            # potential group header (text, no numeric score)
            if b is not None and isinstance(b,str) and b.strip():
                current_group = b.strip()
    return {
        "id": f"cat-{num}",
        "number": str(num),
        "name": NAMES.get(num, f"Category {num}"),
        "subtitle": " / ".join(subtitle),
        "questions": questions
    }

bounds = CAT_ROWS + [BONUS_ROW]
categories = []
for i, start in enumerate(CAT_ROWS):
    num = ws.cell(start,1).value
    end = bounds[i+1]
    categories.append(parse_category(num, start, end))

# Bonus category
bonus_qs = []
qi=0
for r in range(BONUS_ROW, END):
    c = ws.cell(r,3).value; b = cell(r,2); d = cell(r,4); a=cell(r,1)
    if isinstance(c,(int,float)):
        qi+=1
        bonus_qs.append({"id":f"bonus-q{qi}","ref":str(a) if a else str(qi),"group":"Bonus Criteria",
                         "text":b if b else "","maxScore":c,"guidance":d if d else ""})
categories.append({"id":"cat-bonus","number":"B","name":"Bonus Criteria","subtitle":"","questions":bonus_qs,"bonus":True})

# --- Clone Dry Goods (cat-12) template for the other grocery aisle departments ---
CLONE_DEPTS = ["Breakfast","Main Meals","Home Care","Pet Care","General Merchandise",
               "Personal Care","Baby","Snacking","Health","Bulk"]
dry = next(c for c in categories if c["id"]=="cat-12")
clones = []
for n, dept in enumerate(CLONE_DEPTS, start=1):
    cl = copy.deepcopy(dry)
    cl["id"] = f"cat-12-{n}"
    cl["number"] = f"12.{n}"
    cl["name"] = f"{dept} - Shop Floor"
    cl["subtitle"] = f"SHOP FLOOR / {dept.upper()}"
    cl["clonedFrom"] = "Dry Goods - Shop Floor"
    # re-id questions so they are unique
    for qn, q in enumerate(cl["questions"], start=1):
        q["id"] = f"c12_{n}-q{qn}"
        # rewrite leading "Dry Goods" mentions in group text
        if q["group"]:
            q["group"] = q["group"].replace("Dry Goods", dept)
        q["text"] = q["text"].replace("Dry Goods", dept)
    clones.append(cl)

# insert clones right after Dry Goods (index of cat-12)
idx = next(i for i,c in enumerate(categories) if c["id"]=="cat-12")
for off, cl in enumerate(clones, start=1):
    categories.insert(idx+off, cl)

def weight(cat): return sum(q["maxScore"] for q in cat["questions"])

data = {
  "meta": {
    "title": "SPAR ROC National — Retail Operations Checklist",
    "shortTitle": "ROC National",
    "version": "FY2025 (04.05.25)",
    "passThresholdPct": 80,
    "scoreNote": "Each question's maximum points = its weight. Award the full points, 0, or a partial value. Mark N/A to exclude a question from both weight and score.",
    "severityLevels": ["Minor","Major","Critical"],
    "source": "ROC_National_04.05.25_Checklist.xlsx",
    "clonedAisleNote": "Aisle departments Breakfast..Bulk are cloned from the Dry Goods template, matching the SPAR summary report which audits each grocery aisle separately."
  },
  "categories": categories
}

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "js"), exist_ok=True)
out = os.path.join(ROOT, "data", "questions.json")
with open(out, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

# Embedded JS copy so the app works when index.html is opened directly (file://).
js = ("// AUTO-GENERATED from data/questions.json by tools/build_questions.py — do not edit by hand.\n"
      "window.CHECKLIST = " + json.dumps(data, ensure_ascii=False) + ";\n")
with open(os.path.join(ROOT, "js", "checklist-data.js"), "w") as f:
    f.write(js)

# report
tot = 0; totq = 0
print(f"{'#':>5}  {'weight':>6} {'q':>4}  name")
for c in categories:
    w = weight(c); tot += w; totq += len(c["questions"])
    print(f"{c['number']:>5}  {w:>6} {len(c['questions']):>4}  {c['name']}")
print(f"TOTAL categories={len(categories)} questions={totq} max_weight={tot}")
