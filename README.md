# Golden Retrievers

Archive and store for a Buffalo men's-league hockey team, est. 2011.

**The thesis:** platform migration kills amateur sports history. This club's
record was scattered across five dead or living platforms. Every figure on the
site traces back to a stored page.

---

## What is here

| | |
| --- | --- |
| **31 sessions** | 2011-12 → 2026, unbroken except two |
| **80 players** | every name the record can produce |
| **328 games** | 317 played, from 2012-09-24 |
| **1,178 goals · 1,310 assists** | off scoresheets, where they survive |
| **4,932 captures** | the corpus every figure is derived from |
| **425 tests** | all against real captured bytes |

Two half-years are absent: **Summer 2017** (played, record not found) and
**Summer 2020** (not played — COVID).

---

## Stack

- **Next.js 15**, static export — no server, no database, no runtime fetch
- **Node 24** with native TypeScript type-stripping — no enums, no parameter
  properties, no decorators
- **Three.js / React Three Fiber** for the two 3D scenes
- **Blender** for asset authoring, offline
- `apps/web/data/site.json` is the single source for every rendered page

```
apps/web/        the site
packages/capture/  fetches and stores source bytes
packages/parse/    reads those bytes into records
packages/build/    generates site.json
packages/store/    Printify catalogue
data/              the corpus — blobs, a capture log, and the derived records
```

---

## Run it

```bash
npm install
npm run dev          # build:data + next dev
npm run build:data   # regenerate apps/web/data/site.json from the corpus
npm run build:site   # static export -> apps/web/out/
npm test             # 425 tests
npm run typecheck    # excludes apps/web; for app code:
                     #   npx tsc --noEmit -p apps/web/tsconfig.json
```

**A clone regenerates `site.json` byte for byte.** Everything `build:data` reads
is in this repository, so the daily refresh runs on a build server rather than
on one man's laptop. Nothing in the pipeline needs a file that is not here, and
a missing input is an error rather than an empty array.

**Never run `next build` while `next dev` is running.** They share `.next`; the
build corrupts the dev server and the 500s look exactly like a code error.

---

## How the data works

**One rule above the others: absence is not zero.** A missing figure renders as
unrecorded, never as `0`. A season nobody kept and a season nobody played are
different facts and the site says which is which.

- Every parser is verified against **real captured bytes**. An invented fixture
  once passed 13 of 13 tests here and produced 1,064 phantom goals.
- Sessions carry provenance. Where two sources disagree, the fuller record wins
  and the disagreement is recorded rather than hidden.
- Coverage is stated per session on `/seasons` — game log, scoresheets, roster
  and statistics, each complete, partial or missing.
- `npm run sync:current` refreshes the live season: capture → diff → regenerate
  → guard → verify. A run with nothing new makes zero network requests. The
  guard fails on any decrease, including any single player's totals.
- Three sources were never web pages — the captain's statistics workbook, his
  roster book and five roster emails. They are parsed once and the records are
  stored in `data/derived/`, so every input to the build is in this repository
  and none of the private documents is.

---

## Not in this repository

Working material and private source documents are deliberately excluded:
the club's spreadsheets (finances, dues, USA Hockey registration numbers),
his roster emails (six more of those numbers), research evidence, review
artefacts, and the rejected dog-animation study.

What the archive keeps of the three that hold hockey history is their PARSED
RECORD, in `data/derived/`: a name, a number, a position, a stat line. The
finances and the identifiers are refused at the parse boundary and never reach
it — asserted over the stored files themselves, not over the parsers, in
`packages/build/test/derived-records.test.ts`.

---

Data belongs to the club. Code is provided as-is.
