# Feature Request: Daily Chitas Summary Skill

**Date:** 2026-03-08
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

There's no automated daily learning summary for Chitas — the daily Chabad study regimen of Chumash+Rashi, Tanya, and Hayom Yom. Reading and synthesizing these requires visiting multiple sites and a physical/PDF booklet (Dvar Malchus). A multi-agent pipeline can fetch, extract, verify, and synthesize these into a single morning briefing.

## Proposed Solution

A `chitas-summary` skill that runs a multi-agent pipeline daily, producing a structured WhatsApp-formatted summary with:
- Chumash + Rashi (English, from Chabad.org)
- Chassidic Parsha Insights (from Dvar Malchus — נקודות משיחות קודש sections)
- Tanya (English, from Chabad.org)
- Hayom Yom (bilingual Hebrew/English, from Chabad.org)

All claims verified. Final output sent to the main chat each morning.

---

## Pipeline Architecture

### Stage 1: Parallel extraction (4 agents)

**Agent 1 — chumash-rashi**
- Source: `https://www.chabad.org/dailystudy/torahreading.asp?tdate=M/D/YYYY`
- Note: Chabad.org returns 403 to scrapers — must use `agent-browser` (headless browser)
- Extract: portion name, verses studied today, Torah text summary, key Rashi comments with verse refs
- Output: structured JSON with claims + source URL evidence

**Agent 2 — tanya**
- Source: `https://www.chabad.org/dailystudy/tanya.asp?tdate=M/D/YYYY`
- Note: Same — requires `agent-browser`
- Extract: chapter/section, core concepts, key Hebrew terms + English translations
- Output: structured JSON with claims + source URL evidence

**Agent 3 — hayom-yom**
- Source: `https://www.chabad.org/dailystudy/hayomyom.asp?tdate=M/D/YYYY`
- Note: Same — requires `agent-browser`
- Extract: Jewish calendar date, full bilingual text (Hebrew + English)
- Output: structured JSON

**Agent 4 — dvar-malchus**
- Source: Current week's Dvar Malchus PDF (see PDF Sourcing below)
- Extract using layout-aware parsing (see Docling requirement below):
  - Today's Chumash/Rashi column in Hebrew
  - Today's Tanya section with surrounding explanation columns
  - All נקודות משיחות קודש / Niknuot Meshichos Kodesh sections (marked with special headers)
- Output: structured JSON with page refs as evidence

### Stage 2: נקודות משיחות קודש collector

Dedicated agent that receives all Niknuot sections from Agent 4, synthesizes the key Chassidic insights on the parsha into 3-5 bullet points. These become the "Chassidic Parsha Insights" section in the final output.

### Stage 3: Verification agent

- Cross-references Chumash/Rashi between Chabad.org (Agent 1) and Dvar Malchus Hebrew (Agent 4) — same pesukim?
- Confirms Tanya chapter matches the annual schedule
- Flags any factual discrepancies with confidence levels
- Output: verified claim set + list of flagged issues

### Stage 4: Synthesis agent

Produces final WhatsApp-formatted message:

```
📖 *Chitas — [Weekday, Hebrew Date, Gregorian Date]*

*Chumash + Rashi*
_[Portion name, e.g. Vayikra 1:1–13]_
[2-3 paragraph summary]
• Key Rashi on [pasuk]: [explanation]
• Key Rashi on [pasuk]: [explanation]

✡️ *Chassidic Parsha Insights*
• [Niknuot point 1]
• [Niknuot point 2]
• [Niknuot point 3]

📚 *Tanya*
_[e.g. Likutei Amarim, Chapter 12]_
[Core concept summary — 2-3 paragraphs]
Key term: _[Hebrew]_ — [English definition]

🗓 *Hayom Yom*
_[Hebrew date]_
[Hebrew text]
[English translation]
```

---

## PDF Sourcing — Dvar Malchus

The Dvar Malchus is a weekly booklet published each Shabbos. Potential sources (need agent-browser to navigate):

| Source | Notes |
|--------|-------|
| https://livingmoshiach.com/library | Appears to have PDFs; needs browser navigation |
| https://rebbe770.com/dvar-malchus-texts | Mentioned as PDF format |
| https://www.tutaltz.com/dm | Original text with notes |
| https://torah4blind.org/hebrew/dm-index.htm | Hebrew text versions |

**Implementation approach:** Each week on Shabbos or Motzei Shabbos, a setup agent uses `agent-browser` to find and download the current week's PDF, saving it to a known path (e.g., `/workspace/project/scripts/scratch/dvar-malchus-current.pdf`). The daily pipeline reads from this cached file.

---

## Docling Requirement (Critical Dependency)

The Dvar Malchus PDF has a complex multi-column layout:
- **Center column:** main text (Chumash/Rashi or Tanya)
- **Left/right columns:** explanatory Chassidic commentary
- **Section headers:** נקודות משיחות קודש appear with distinctive formatting

Standard PDF text extraction (pdf-parse, pdfjs) outputs columns in unpredictable order and loses layout context entirely. This makes it impossible to distinguish the main text column from commentary columns, or to reliably locate the Niknuot sections.

**Docling** (https://github.com/DS4SD/docling) is a Python library by IBM Research that performs layout-aware PDF parsing — it understands column order, section headers, reading flow, and table structure.

**Host-side requirement:**
```bash
pip install docling
# or
uv pip install docling
```

**Usage from container:**
```bash
# Write a wrapper script the agent can call
python3 -c "
from docling.document_converter import DocumentConverter
conv = DocumentConverter()
result = conv.convert('/workspace/project/scripts/scratch/dvar-malchus-current.pdf')
print(result.document.export_to_markdown())
" > /workspace/project/scripts/scratch/dvar-malchus-parsed.md
```

Or expose it as a Bash skill wrapper `docling-parse <pdf-path>` → outputs markdown with layout preserved.

**Fallback (without docling):** Use `agent-browser` to screenshot each PDF page and extract text visually via Claude's vision. Slower and less reliable for Hebrew RTL text, but functional.

---

## Scheduling

- Run daily at **8:00 AM EST** (after Shacharis)
- Skip on Shabbos/Yom Tov (Chitas is studied but no notification needed — or use a simpler text-only version)
- Shabbos detection: use the `add-shabbat-mode` skill once installed, or check via Hebcal API

---

## Alternatives Considered

**Simple WebFetch scraping:** Chabad.org blocks HTTP scrapers (403). Must use `agent-browser`. Ruled out for direct scraping.

**No PDF, Chabad.org only:** Chabad.org has English Chumash/Rashi and Tanya, but not Dvar Malchus. The Chassidic Parsha Insights (Niknuot) are unique to Dvar Malchus — can't be sourced elsewhere.

**Single monolithic agent:** Too much context, no parallelism. The 4-agent parallel approach completes in ~2-3 min vs ~8-10 min sequential.

**Embedding into whatsapp-summary:** Chitas is a standalone daily product unrelated to group chat activity. Separate skill is cleaner.

---

## Acceptance Criteria

- [ ] Daily scheduled task at 8am EST produces a formatted Chitas summary
- [ ] Chumash+Rashi section includes portion name, verse range, summary, and ≥2 key Rashi insights
- [ ] Tanya section includes chapter/section and core concept explanation
- [ ] Hayom Yom section includes full bilingual text
- [ ] Chassidic Parsha Insights section includes ≥3 bullet points from נקודות משיחות קודש
- [ ] Verification agent runs and flags any cross-source discrepancies
- [ ] All claims include source citations (URL or PDF page ref)
- [ ] Output formatted for WhatsApp (no markdown headings, uses *bold*, _italic_, bullets)
- [ ] Dvar Malchus PDF downloaded weekly (Motzei Shabbos or Sunday) automatically
- [ ] Docling installed and accessible as a container-callable tool
- [ ] Shabbos/Yom Tov skip logic in place
- [ ] Graceful fallback if any single source is unavailable (partial summary with note)

---

## Technical Notes

**Chabad.org date format:** `?tdate=M/D/YYYY` (Gregorian) — e.g., `?tdate=3/8/2026`

**Hebrew date:** Retrieve from Hebcal API — `https://www.hebcal.com/converter?cfg=json&gy=2026&gm=3&gd=8&g2h=1`

**Skill location:** `/home/node/.claude/skills/chitas-summary/` (stub already created)

**Relevant existing skills:**
- `agent-browser` — for Chabad.org scraping
- `pdf-reader` — fallback PDF parsing (no layout awareness)
- `whatsapp-summary` — reference implementation for multi-agent pipeline pattern

**Docling GitHub:** https://github.com/DS4SD/docling
**Docling docs:** https://ds4sd.github.io/docling/

**Weekly PDF caching:** Store at `/workspace/project/data/chitas/dvar-malchus-current.pdf` with a metadata file tracking which week's edition it is. The daily agent checks if the file is current before using it.

**Related feature requests:** `add-shabbat-mode` skill (for Shabbos skip logic)
