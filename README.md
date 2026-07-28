# Golden Retrievers

Archive and store for a Buffalo men's-league hockey team, est. 2011.

Fifteen years of the club's record, reassembled from five platforms that died or
moved on. Every figure traces back to a stored page.

**31 sessions · 80 players · 328 games · 5,047 captures**

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build:site   # static export -> apps/web/out/
npm test
```

Next.js static export. No server, no database, no runtime fetch.

---

## Layout

```
apps/web/     the site
packages/     capture -> parse -> build
data/         the corpus
```

`data/` holds the source bytes. `packages/build` turns them into
`apps/web/data/site.json`, which is the single source for every rendered page.

---

## One rule

**Absence is not zero.** A missing figure renders as unrecorded, never as `0`.
A season nobody kept and a season nobody played are different facts.

---

Data belongs to the club. Code is provided as-is.
