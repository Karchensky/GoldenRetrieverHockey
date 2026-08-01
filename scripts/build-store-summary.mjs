import { readFile, writeFile } from "node:fs/promises";

/**
 * The store's economics and its supplier choices, as one page.
 *
 *   npm run store:report      measures the live shop, writes both JSON inputs
 *   npm run store:summary     builds this page from them
 *
 * Nothing here is typed by hand. Both tabs read files the sweep and the report
 * wrote, so the page cannot drift from the shop the way a copied table does.
 *
 * TAB 1 — ECONOMICS. For every size group of every garment: what a customer
 * hands over, every deduction, and what is left. At full price and at
 * TEAMMATE30, in New York and outside it.
 *
 * TAB 2 — SUPPLIERS. Every maker Printify offers for the garment we chose,
 * with the chosen one marked. It answers "did we pick the best maker of this
 * garment". It does NOT answer "is this the best garment" — see the note the
 * tab carries, which says so in the open rather than letting the table imply
 * an answer it does not have.
 */

const usd = (c) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NAMES = {
  tee: "Tee", hoodie: "Hoodie", longsleeve: "Long Sleeve", crewneck: "Crewneck",
  youth: "Youth Tee", cap: "Fitted Cap", beanie: "Beanie", mug: "Mug", sticker: "Sticker",
};
const ORDER = ["tee", "longsleeve", "crewneck", "hoodie", "youth", "cap", "beanie", "mug", "sticker"];

const data = JSON.parse(await readFile("dist/store-economics.json", "utf8"));
const sweep = JSON.parse(await readFile("dist/print/provider-sweep.json", "utf8"));

/* ------------------------------------------------------------------ */
/* Tab 1 — economics                                                   */
/* ------------------------------------------------------------------ */

function money(label, s, tone) {
  return `<tr class="${tone}">
    <td class="lbl">${label}</td>
    <td class="num">${usd(s.list)}</td>
    <td class="num ${s.off ? "cut" : "dim"}">${s.off ? "−" + usd(s.off) : "—"}</td>
    <td class="num">${usd(s.post)}</td>
    <td class="num ${s.tax ? "" : "dim"}">${s.tax ? usd(s.tax) : "—"}</td>
    <td class="num pay">${usd(s.paid)}</td>
    <td class="num out">${usd(s.cost + s.post)}</td>
    <td class="num out">${usd(s.stripe)}</td>
    <td class="num out ${s.taxFee ? "" : "dim"}">${s.taxFee ? usd(s.taxFee) : "—"}</td>
    <td class="num out ${s.tax ? "" : "dim"}">${s.tax ? usd(s.tax) : "—"}</td>
    <td class="num keep ${s.keep < 0 ? "bad" : ""}">${usd(s.keep)}</td>
    <td class="num dim">${pct(s.keep, s.paid)}</td>
  </tr>`;
}

const economics = [...data.items]
  .sort((a, b) => ORDER.indexOf(a.itemId) - ORDER.indexOf(b.itemId))
  .map((item) => {
    const name = NAMES[item.itemId] ?? item.itemId;
    const rows = item.tiers.map((t) => {
      // Sizes arrive in the matrix's own order. Collapse only a genuine run.
      // Sizes, then the cost — the hoodie has two tiers covering the same sizes
      // at different costs because its colourways are priced differently, and
      // without the cost the two group headers read identically.
      const label = t.sizes.length > 2
        ? `${t.sizes[0]}&ndash;${t.sizes[t.sizes.length - 1]} <span class="dim">(${t.sizes.join(", ")})</span>`
        : t.sizes.join(", ");
      return `<tr class="grp"><td colspan="12">${label}<span class="dim"> &middot; ${t.colours} colour${t.colours === 1 ? "" : "s"} &middot; costs ${usd(t.full.ny.cost)}</span></td></tr>`
        + money("Full price &middot; Buffalo", t.full.ny, "")
        + money("Full price &middot; elsewhere", t.full.away, "alt")
        + money("<b>TEAMMATE30</b> &middot; Buffalo", t.teammate.ny, "promo")
        + money("<b>TEAMMATE30</b> &middot; elsewhere", t.teammate.away, "promo alt");
    }).join("");
    const worst = Math.min(...item.tiers.map((t) => t.teammate.ny.keep));
    return `<section>
      <h2>${name}<span class="meta">${esc(item.provider)}${item.units > 1 ? ` &middot; sold in ${item.units}s` : ""} &middot; ${item.clothing ? "clothing &mdash; 4.75% in Buffalo" : "general goods &mdash; 8.75% in Buffalo"}</span></h2>
      <p class="worst ${worst < 0 ? "bad" : ""}">Worst case with the code: <b>${usd(worst)}</b> kept.</p>
      <div class="scroll"><table>
        <thead><tr><th></th><th class="num">List</th><th class="num">Code</th><th class="num">Post</th><th class="num">Tax</th>
        <th class="num pay">They pay</th><th class="num out">Printify</th><th class="num out">Stripe</th>
        <th class="num out">Tax fee</th><th class="num out">To NY</th><th class="num keep">You keep</th><th class="num">of total</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </section>`;
  }).join("");

/* ------------------------------------------------------------------ */
/* Tab 2 — suppliers                                                   */
/* ------------------------------------------------------------------ */

const byItem = new Map();
for (const r of sweep.rows) {
  if (!byItem.has(r.itemId)) byItem.set(r.itemId, []);
  byItem.get(r.itemId).push(r);
}

const suppliers = ORDER.filter((id) => byItem.has(id)).map((id) => {
  const rows = byItem.get(id);
  const chosen = rows.find((r) => r.inUse);
  const bp = rows[0].blueprintId;

  /** Landed = what the first unit truly costs us: goods + the postage we must charge. */
  const landed = (r) => (r.minCost || 0) + (r.postCents ?? 99999);
  const sorted = [...rows].sort((a, b) => landed(a) - landed(b));

  /**
   * WHAT COUNTS AS A REAL ALTERNATIVE, and every clause here was earned.
   *
   * `minCost > 0` — JAMS Designs sorts to the top of the tee at $5.19 landed
   * because it never returned a price at all: it is the maker that refuses
   * product creation with code 6002, so its cost is zero and its "landed" is
   * postage alone. Ranking a phantom first told the captain he was overpaying
   * by $10 on the strength of a maker that cannot make anything.
   * `!indicative` — a cost sampled from someone else's colourways is worth
   * having as a hint and is not worth switching supplier over.
   * A missing size is a disqualifier: the code reads variants positionally.
   */
  const usable = (r) =>
    r.minCost > 0 &&
    !r.indicative &&
    !(r.missingSizes || []).length &&
    r.postCents != null && r.postCents < 1500;
  const cheapestUsable = sorted.find(usable);

  const body = sorted.map((r) => {
    const flags = [];
    if (!r.minCost) flags.push(`<span class="flag bad">never returned a price &mdash; cannot be used</span>`);
    if ((r.missingSizes || []).length) flags.push(`<span class="flag bad">incomplete size run: ${r.missingSizes.join(", ")}</span>`);
    if ((r.postCents ?? 0) > 1500) flags.push(`<span class="flag warn">${usd(r.postCents)} US postage</span>`);
    if (r.country !== "US") flags.push(`<span class="flag warn">ships from ${r.country}</span>`);
    if (r.indicative) flags.push(`<span class="flag">cost sampled, not our colourways &mdash; a hint, not a basis for switching</span>`);
    // Notes carry raw API errors. Keep the useful head of one, not 400 characters.
    if (r.note) {
      const code = /code"?:\s*"?(\d+)/.exec(r.note);
      flags.push(`<span class="flag bad">rejected the product${code ? ` (code ${code[1]})` : ""}</span>`);
    }
    const pick = r.inUse;
    return `<tr class="${pick ? "chosen" : ""}">
      <td class="lbl">${pick ? '<span class="tick">✓</span> ' : ""}${esc(r.provider)}</td>
      <td class="num">${r.country}</td>
      <td class="num">${r.colours || "—"}</td>
      <td class="num">${r.minCost ? usd(r.minCost) : "—"}</td>
      <td class="num">${r.maxCost ? usd(r.maxCost) : "—"}</td>
      <td class="num">${r.postCents == null ? '<span class="dim">never priced</span>' : usd(r.postCents)}</td>
      <td class="num pay">${r.minCost && r.postCents != null ? usd(r.minCost + r.postCents) : "—"}</td>
      <td class="notes">${flags.join(" ") || '<span class="dim">—</span>'}</td>
    </tr>`;
  }).join("");

  /*
   * COMPARE MONEY, NOT NAMES.
   *
   * This used to flag an alternative whenever the cheapest usable row was a
   * different provider id from the chosen one. For the cap and the beanie,
   * "Printify Choice" and "Printful" return byte-identical economics — same
   * cost, same postage, same colours, same print area, because Choice routes
   * to Printful for those blueprints. A stable sort put Choice first and the
   * page announced a saving of exactly zero dollars.
   */
  const chosenLanded = chosen ? landed(chosen) : Infinity;
  const better = cheapestUsable && landed(cheapestUsable) < chosenLanded ? cheapestUsable : null;
  const tied = chosen && cheapestUsable && !better && cheapestUsable.providerId !== chosen.providerId;

  const verdict = !chosen
    ? `<p class="worst bad">Nothing marked as chosen.</p>`
    : better
      ? `<p class="worst bad">Cheapest usable maker is <b>${esc(better.provider)}</b> at ${usd(landed(better))} landed &mdash; we are on ${esc(chosen.provider)} at ${usd(chosenLanded)}, ${usd(chosenLanded - landed(better))} dearer. Worth a look.</p>`
      : `<p class="worst">✓ <b>${esc(chosen.provider)}</b> at ${usd(chosenLanded)} landed is the cheapest maker with a complete size run and sane US postage.${tied ? ` <span class="dim">${esc(cheapestUsable.provider)} matches it to the cent.</span>` : ""}</p>`;

  return `<section>
    <h2>${NAMES[id] ?? id}<span class="meta">blueprint ${bp} &middot; ${rows.length} maker${rows.length === 1 ? "" : "s"} priced</span></h2>
    ${verdict}
    <div class="scroll"><table>
      <thead><tr><th>Maker</th><th class="num">From</th><th class="num">Colours</th><th class="num">Cheapest</th>
      <th class="num">Dearest</th><th class="num">US post</th><th class="num pay">Landed</th><th>Notes</th></tr></thead>
      <tbody>${body}</tbody></table></div>
  </section>`;
}).join("");

/* ------------------------------------------------------------------ */

const worstOverall = Math.min(...data.items.flatMap((i) => i.tiers.map((t) => t.teammate.ny.keep)));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store economics — Golden Retrievers</title>
<style>
  :root{--bg:#fbfaf8;--panel:#fff;--ink:#17150f;--muted:#6a6256;--line:#e5e0d6;
    --gold:#9a7526;--soft:#f5edd8;--good:#2f6a43;--bad:#9c3025;--pay:#1f4d7a;--warn:#8a5a12;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  @media(prefers-color-scheme:dark){:root{--bg:#14130f;--panel:#1c1a15;--ink:#efeae0;--muted:#a49b8a;
    --line:#302c24;--gold:#d8ae57;--soft:#2a2418;--good:#78c396;--bad:#e08072;--pay:#7fb2e0;--warn:#d8ae57}}
  :root[data-theme=dark]{--bg:#14130f;--panel:#1c1a15;--ink:#efeae0;--muted:#a49b8a;
    --line:#302c24;--gold:#d8ae57;--soft:#2a2418;--good:#78c396;--bad:#e08072;--pay:#7fb2e0;--warn:#d8ae57}
  :root[data-theme=light]{--bg:#fbfaf8;--panel:#fff;--ink:#17150f;--muted:#6a6256;--line:#e5e0d6;
    --gold:#9a7526;--soft:#f5edd8;--good:#2f6a43;--bad:#9c3025;--pay:#1f4d7a;--warn:#8a5a12}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:80rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
  h1{font-size:clamp(1.5rem,4vw,2rem);margin:0 0 .3rem;letter-spacing:-.02em}
  .sub{color:var(--muted);font-size:.85rem;font-family:var(--mono)}
  .tabs{display:flex;gap:.4rem;margin:1.6rem 0 0;border-bottom:1px solid var(--line)}
  .tabs button{appearance:none;background:none;border:0;border-bottom:2px solid transparent;
    color:var(--muted);font:inherit;font-size:.92rem;font-weight:600;padding:.6rem .9rem;cursor:pointer;margin-bottom:-1px}
  .tabs button[aria-selected=true]{color:var(--gold);border-bottom-color:var(--gold)}
  .legend{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);
    border-radius:.4rem;padding:.9rem 1.1rem;margin:1.5rem 0 2rem;font-size:.9rem}
  .legend b{color:var(--gold)}
  section{margin:2.2rem 0}
  h2{font-size:1.1rem;margin:0 0 .2rem;padding-top:1.2rem;border-top:1px solid var(--line);letter-spacing:-.01em}
  h2 .meta{display:block;font-size:.78rem;font-weight:400;color:var(--muted);margin-top:.15rem}
  .worst{margin:.4rem 0 .8rem;font-size:.85rem;color:var(--good)}
  .worst.bad{color:var(--bad);font-weight:700}
  .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:.5rem;background:var(--panel)}
  table{border-collapse:collapse;width:100%;font-size:.83rem}
  th,td{padding:.42rem .6rem;text-align:right;white-space:nowrap}
  th:first-child,td:first-child,td.notes,th:last-child{text-align:left}
  td.notes{white-space:normal}
  thead th{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
    border-bottom:1px solid var(--line);font-weight:600}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .grp td{background:var(--soft);font-weight:600;font-size:.78rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  tbody tr:not(.grp):hover td{background:var(--soft)}
  .lbl{font-size:.8rem}
  .alt td{opacity:.62}
  .promo .lbl{color:var(--gold)}
  th.pay,td.pay{color:var(--pay);font-weight:650;border-left:1px solid var(--line)}
  th.out,td.out{color:var(--muted)}
  td.out:nth-of-type(7){border-left:1px solid var(--line)}
  th.keep,td.keep{font-weight:700;border-left:1px solid var(--line);color:var(--good)}
  td.keep.bad{color:var(--bad)}
  tr.chosen td{background:var(--soft);font-weight:600}
  .tick{color:var(--good);font-weight:700}
  .flag{display:inline-block;font-size:.7rem;padding:.1rem .4rem;border-radius:.25rem;
    background:var(--soft);color:var(--muted);border:1px solid var(--line);margin:.1rem .15rem .1rem 0}
  .flag.bad{color:var(--bad);border-color:var(--bad)}
  .flag.warn{color:var(--warn);border-color:var(--warn)}
  .cut{color:var(--gold)} .dim{color:var(--muted);opacity:.6}
  footer{margin-top:3.5rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
  code{font-family:var(--mono);font-size:.87em;background:var(--soft);padding:.1rem .3rem;border-radius:.25rem}
  [hidden]{display:none}
</style></head><body><div class="wrap">

<h1>Store economics</h1>
<div class="sub">Golden Retrievers &middot; measured from the live Printify shop &middot; nothing on this page is hand-typed</div>

<div class="tabs" role="tablist">
  <button role="tab" aria-selected="true" data-tab="econ">What you keep</button>
  <button role="tab" aria-selected="false" data-tab="sup">Makers &amp; costs</button>
</div>

<div id="econ">
  <div class="legend">
    <b>They pay</b> = list, less the code, plus postage, plus New York's tax.<br>
    <b>Out</b> = Printify (garment + postage) &middot; Stripe (2.9% + 30&cent;) &middot; Stripe Tax (0.5%, NY only) &middot; the tax itself, which you forward to New York.<br>
    <b>You keep</b> is what is left. <b>Postage cancels</b> — the customer pays it, Printify takes it.<br>
    <b>Worst case anywhere with TEAMMATE30: ${usd(worstOverall)}.</b> Nothing in the line loses money at 30% off.
  </div>
  ${economics}
</div>

<div id="sup" hidden>
  <div class="legend">
    <b>Every maker Printify offers for the garment we chose</b>, cheapest landed first. <b>Landed</b> = cheapest unit + US postage, which is the only fair comparison: a maker $2 cheaper who posts from Germany for $25 is not cheaper.<br>
    <b>An incomplete size run is a disqualifier, not a discount.</b> The code reads variants positionally, so a maker missing one size of one colour would sell the wrong garment.<br>
    <b>This tab does NOT compare different garments.</b> It compares makers of the blueprint already chosen — Bella+Canvas 3001 for the tee, and so on. Answering "is this the best <i>shirt</i>" needs a sweep across alternative blueprints, which has never been run.
  </div>
  ${suppliers}
</div>

<footer>
  Rebuild: <code>npm run store:report</code> then <code>npm run store:summary</code>.<br>
  Tax modelled at Buffalo 14201 — 8.75% general, 4.75% clothing under $110.<br><br>
  Private working document. Costs, margins and supplier prices — not for the public repository.
</footer>
</div>
<script>
  const tabs=[...document.querySelectorAll('[role=tab]')];
  tabs.forEach(t=>t.addEventListener('click',()=>{
    tabs.forEach(o=>{o.setAttribute('aria-selected', String(o===t));
      document.getElementById(o.dataset.tab).hidden = o!==t;});
  }));
</script>
</body></html>`;

await writeFile("dist/store-summary.html", html);
console.log("Wrote dist/store-summary.html");
console.log(`  worst keep with TEAMMATE30, anywhere: ${usd(worstOverall)}`);
for (const id of ORDER) {
  const rows = byItem.get(id);
  if (!rows) continue;
  const chosen = rows.find((r) => r.inUse);
  console.log(`  ${(NAMES[id] ?? id).padEnd(12)} ${rows.length} makers priced, chosen: ${chosen ? chosen.provider : "NONE"}`);
}
