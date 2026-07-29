# Golden Retrievers

Archive and store for The Golden Retrievers, Buffalo's premier golden retriever themed hockey team, est. 2011.

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

Data belongs to the club. Code is provided as-is.
