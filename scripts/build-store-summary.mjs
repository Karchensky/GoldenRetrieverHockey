import { readFile, writeFile } from "node:fs/promises";

/**
 * The store's economics, as a page you can open.
 *
 * Reads `dist/store-economics.json`, which `npm run store:report` writes from
 * the LIVE Printify shop. Nothing here is typed by hand, so the page cannot
 * drift from the shop the way a copied table would.
 *
 *   npm run store:report      measures the shop, writes the JSON
 *   npm run store:summary     builds this page from it
 *
 * WHAT IT ANSWERS, which the console report did not: for every size group of
 * every garment, what a customer actually hands over, every deduction that
 * comes out of it, and what is left — at full price and at TEAMMATE30, in New
 * York and outside it.
 *
 * The two New York costs are the ones worth having on a page. Stripe charges
 * 2.9% of the WHOLE payment including the sales tax being collected for
 * somebody else, and Stripe Tax bills another 0.5% of the same total. On a $23
 * mug that is sixteen cents nobody would find by reading the margin.
 */

const usd = (c) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

const NAMES = {
  tee: "Tee", hoodie: "Hoodie", longsleeve: "Long Sleeve", crewneck: "Crewneck",
  youth: "Youth Tee", cap: "Fitted Cap", beanie: "Beanie", mug: "Mug", sticker: "Sticker",
};

const data = JSON.parse(await readFile("dist/store-economics.json", "utf8"));

/** One priced line: what they pay, what leaves, what stays. */
function row(label, s, units, tone) {
  const printify = s.cost + s.post;
  return `<tr class="${tone}">
    <td class="lbl">${label}</td>
    <td class="num">${usd(s.list)}</td>
    <td class="num ${s.off ? "cut" : "dim"}">${s.off ? "−" + usd(s.off) : "—"}</td>
    <td class="num">${usd(s.post)}</td>
    <td class="num ${s.tax ? "" : "dim"}">${s.tax ? usd(s.tax) : "—"}</td>
    <td class="num pay">${usd(s.paid)}</td>
    <td class="num out">${usd(printify)}</td>
    <td class="num out">${usd(s.stripe)}</td>
    <td class="num out ${s.taxFee ? "" : "dim"}">${s.taxFee ? usd(s.taxFee) : "—"}</td>
    <td class="num out ${s.tax ? "" : "dim"}">${s.tax ? usd(s.tax) : "—"}</td>
    <td class="num keep ${s.keep < 0 ? "bad" : ""}">${usd(s.keep)}</td>
    <td class="num dim">${pct(s.keep, s.paid)}</td>
  </tr>`;
}

const sections = data.items.map((item) => {
  const name = NAMES[item.itemId] ?? item.itemId;
  const unitNote = item.units > 1 ? ` &middot; sold in ${item.units}s` : "";
  const tiers = item.tiers.map((t) => {
    const sizes = t.sizes.length > 3
      ? `${t.sizes[0]}&ndash;${t.sizes[t.sizes.length - 1]}`
      : t.sizes.join(", ");
    const head = `<tr class="grp"><td colspan="12">${sizes}<span class="dim"> &middot; ${t.colours} colour${t.colours === 1 ? "" : "s"}</span></td></tr>`;
    return head
      + row("Full price &middot; Buffalo", t.full.ny, item.units, "")
      + row("Full price &middot; elsewhere", t.full.away, item.units, "alt")
      + row("<b>TEAMMATE30</b> &middot; Buffalo", t.teammate.ny, item.units, "promo")
      + row("<b>TEAMMATE30</b> &middot; elsewhere", t.teammate.away, item.units, "promo alt");
  }).join("");

  const worst = Math.min(...item.tiers.map((t) => t.teammate.ny.keep));
  return `<section>
    <h2>${name}<span class="meta">${item.provider}${unitNote} &middot; ${item.clothing ? "clothing &mdash; 4.75% in Buffalo" : "general goods &mdash; 8.75% in Buffalo"}</span></h2>
    <p class="worst ${worst < 0 ? "bad" : ""}">Worst case with the code: <b>${usd(worst)}</b> kept.</p>
    <div class="scroll"><table>
      <thead><tr>
        <th></th><th class="num">List</th><th class="num">Code</th><th class="num">Post</th><th class="num">Tax</th>
        <th class="num pay">They pay</th>
        <th class="num out">Printify</th><th class="num out">Stripe</th><th class="num out">Tax fee</th><th class="num out">To NY</th>
        <th class="num keep">You keep</th><th class="num">of total</th>
      </tr></thead>
      <tbody>${tiers}</tbody>
    </table></div>
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store economics — Golden Retrievers</title>
<style>
  :root{--bg:#fbfaf8;--panel:#fff;--ink:#17150f;--muted:#6a6256;--line:#e5e0d6;
    --gold:#9a7526;--soft:#f5edd8;--good:#2f6a43;--bad:#9c3025;--pay:#1f4d7a;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  @media(prefers-color-scheme:dark){:root{--bg:#14130f;--panel:#1c1a15;--ink:#efeae0;--muted:#a49b8a;
    --line:#302c24;--gold:#d8ae57;--soft:#2a2418;--good:#78c396;--bad:#e08072;--pay:#7fb2e0}}
  :root[data-theme=dark]{--bg:#14130f;--panel:#1c1a15;--ink:#efeae0;--muted:#a49b8a;
    --line:#302c24;--gold:#d8ae57;--soft:#2a2418;--good:#78c396;--bad:#e08072;--pay:#7fb2e0}
  :root[data-theme=light]{--bg:#fbfaf8;--panel:#fff;--ink:#17150f;--muted:#6a6256;--line:#e5e0d6;
    --gold:#9a7526;--soft:#f5edd8;--good:#2f6a43;--bad:#9c3025;--pay:#1f4d7a}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:78rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
  h1{font-size:clamp(1.5rem,4vw,2rem);margin:0 0 .3rem;letter-spacing:-.02em}
  .sub{color:var(--muted);font-size:.85rem;font-family:var(--mono)}
  .legend{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);
    border-radius:.4rem;padding:.9rem 1.1rem;margin:1.5rem 0 2rem;font-size:.9rem}
  .legend b{color:var(--gold)}
  section{margin:2.5rem 0}
  h2{font-size:1.1rem;margin:0 0 .2rem;padding-top:1.2rem;border-top:1px solid var(--line);letter-spacing:-.01em}
  h2 .meta{display:block;font-size:.78rem;font-weight:400;color:var(--muted);margin-top:.15rem}
  .worst{margin:.4rem 0 .8rem;font-size:.85rem;color:var(--good)}
  .worst.bad{color:var(--bad);font-weight:700}
  .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:.5rem;background:var(--panel)}
  table{border-collapse:collapse;width:100%;font-size:.83rem}
  th,td{padding:.42rem .6rem;text-align:right;white-space:nowrap}
  th:first-child,td:first-child{text-align:left}
  thead th{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
    border-bottom:1px solid var(--line);font-weight:600}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .grp td{background:var(--soft);font-weight:600;font-size:.78rem;letter-spacing:.03em;
    border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  tbody tr:not(.grp):hover td{background:var(--soft)}
  .lbl{font-size:.8rem}
  .alt td{opacity:.62}
  .promo .lbl{color:var(--gold)}
  th.pay,td.pay{color:var(--pay);font-weight:650;border-left:1px solid var(--line)}
  th.out,td.out{color:var(--muted)}
  th.out:first-of-type,td.out:nth-of-type(7){border-left:1px solid var(--line)}
  th.keep,td.keep{font-weight:700;border-left:1px solid var(--line);color:var(--good)}
  td.keep.bad{color:var(--bad)}
  .cut{color:var(--gold)}
  .dim{color:var(--muted);opacity:.55}
  footer{margin-top:3.5rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
  code{font-family:var(--mono);font-size:.87em;background:var(--soft);padding:.1rem .3rem;border-radius:.25rem}
</style></head><body><div class="wrap">

<h1>Store economics</h1>
<div class="sub">Golden Retrievers &middot; every size group &middot; measured from the live Printify shop</div>

<div class="legend">
  <b>They pay</b> = list, less the code, plus postage, plus New York's tax.<br>
  <b>Out</b> = Printify (garment + postage) &middot; Stripe (2.9% + 30&cent;) &middot; Stripe Tax (0.5%, NY only) &middot; the tax itself, which you forward to New York.<br>
  <b>You keep</b> is what is actually left. <b>Postage cancels</b> — the customer pays it and Printify takes it.<br>
  <b>Buffalo rows cost more than they look.</b> Stripe's 2.9% is charged on the whole payment <i>including</i> the sales tax you are only holding, and Stripe Tax adds 0.5% of the same total.
</div>

${sections}

<footer>
  Rebuild: <code>npm run store:report</code> then <code>npm run store:summary</code>. The report reads the live shop; nothing on this page is hand-typed.<br>
  Tax modelled at Erie County, Buffalo 14201 — 8.75% general, 4.75% clothing under $110. Sticker rows are a pack of ${data.items.find((i) => i.itemId === "sticker")?.units ?? 3}.<br><br>
  Private working document. Costs, margins and supplier prices — not for the public repository.
</footer>
</div></body></html>`;

await writeFile("dist/store-summary.html", html);
console.log("Wrote dist/store-summary.html");
for (const item of data.items) {
  const worst = Math.min(...item.tiers.map((t) => t.teammate.ny.keep));
  console.log(`  ${(NAMES[item.itemId] ?? item.itemId).padEnd(12)} worst with TEAMMATE30: ${usd(worst)}`);
}
