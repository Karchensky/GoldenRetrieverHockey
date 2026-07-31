# Golden Retrievers

Archive and store for The Golden Retrievers, Buffalo's premier
golden-retriever-themed hockey team, est. 2011.

Fifteen seasons of a men's-league club, recovered from four platforms that no
longer serve it, plus a print-on-demand store on the same domain.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3002
npm run build:site   # static export -> apps/web/out/
npm test
```

Do not run `build:site` while `dev` is running — see the handbook.

---

## Layout

```
data/       the corpus — captured bytes, the only source of truth
packages/   capture -> build -> store
apps/web/   the site
workers/    the Cloudflare Worker (checkout only)
docs/       artwork and the handbook
```

`packages/build` turns the corpus into `apps/web/data/site.json`, which is the
single source for every rendered page. Next.js static export: no server, no
database, no runtime fetch on any archive page.

---

Data belongs to the club. Code is provided as-is.
