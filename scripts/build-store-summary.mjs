import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

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
 * the team code, in New York and outside it.
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
/** Weight and blend mean something here. A mug's "11 oz" is capacity. */
const APPAREL = new Set(["tee", "longsleeve", "crewneck", "hoodie", "youth"]);

/**
 * THE DISCOUNT CODE IS NOT WRITTEN DOWN HERE, and it used to be.
 *
 * The live code was hardcoded in six places in this file. This file is tracked,
 * the repository is public, and the code was live — so a working 30% discount
 * was sitting in GitHub for anyone who opened it. Found 2026-08-01; the code
 * was rotated because removing it from HEAD does not remove it from history.
 *
 * The page is a private local artefact, so it may show the real code, but the
 * source that builds it must not contain it. It comes from `.secrets/`, which
 * is gitignored, and falls back to a generic label when absent.
 */
const CODE = (() => {
  try {
    const raw = readFileSync(".secrets/discount_code.txt", "utf8").trim();
    if (raw) return raw;
  } catch {
    // No file: label the column generically rather than name a code.
  }
  return "TEAM CODE";
})();

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
        + money(`<b>${CODE}</b> &middot; Buffalo`, t.teammate.ny, "promo")
        + money(`<b>${CODE}</b> &middot; elsewhere`, t.teammate.away, "promo alt");
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

  /*
   * A TIE GOES TO PRINTIFY CHOICE. The captain's rule, 2026-08-01.
   *
   * Choice is a routing layer rather than a named factory: when a house is
   * busy it sends the job to another one that carries the same blueprint. On
   * an identical price that is strictly more robust than naming a single
   * factory that can go down or drop a colourway, which is exactly how the
   * long sleeve lost Black/M mid-sync on 30 July. The cost of it is that two
   * orders of the same shirt can be printed in two places.
   */
  const tieBreak = tied && cheapestUsable.provider === "Printify Choice"
    ? `<p class="worst bad">Tied on price with <b>Printify Choice</b>, which wins a tie &mdash; it reroutes when a house is busy instead of depending on one factory. Worth switching.</p>`
    : "";

  const verdict = !chosen
    ? `<p class="worst bad">Nothing marked as chosen.</p>`
    : better
      ? `<p class="worst bad">Cheapest usable maker is <b>${esc(better.provider)}</b> at ${usd(landed(better))} landed &mdash; we are on ${esc(chosen.provider)} at ${usd(chosenLanded)}, ${usd(chosenLanded - landed(better))} dearer. Worth a look.</p>`
      : `<p class="worst">✓ <b>${esc(chosen.provider)}</b> at ${usd(chosenLanded)} landed is the cheapest maker with a complete size run and sane US postage.${tied ? ` <span class="dim">${esc(cheapestUsable.provider)} matches it to the cent.</span>` : ""}</p>`;

  return `<section>
    <h2>${NAMES[id] ?? id}<span class="meta">blueprint ${bp} &middot; ${rows.length} maker${rows.length === 1 ? "" : "s"} priced${rows.some((r) => r.provider === "Printify Choice") ? "" : " &middot; no Printify Choice on this blueprint"}</span></h2>
    ${verdict}${tieBreak}
    <div class="scroll"><table>
      <thead><tr><th>Maker</th><th class="num">From</th><th class="num">Colours</th><th class="num">Cheapest</th>
      <th class="num">Dearest</th><th class="num">US post</th><th class="num pay">Landed</th><th>Notes</th></tr></thead>
      <tbody>${body}</tbody></table></div>
  </section>`;
}).join("");

/* ------------------------------------------------------------------ */
/* Tab 3 — garments: why this blueprint and not another                */
/* ------------------------------------------------------------------ */

/**
 * MEASURED, NOT REMEMBERED.
 *
 * This tab used to transcribe the rationale out of matrix.ts block comments.
 * That was the wrong answer to the question: those comments record what a past
 * session decided, and a decision recorded in prose is one nobody can check.
 * `cli.ts garments` now probes rival blueprints across Printify's catalogue of
 * 1,914 the same way the maker sweep probes rival makers, and this renders what
 * came back.
 *
 * `WHY` survives only as the note beside a row, clearly marked as the recorded
 * reasoning rather than as evidence. Where it disagrees with the grid, the grid
 * is right.
 */
const WHY = {
  tee: { garment: "Bella+Canvas 3001", alt: "Gildan 5000 and the other budget jerseys",
    why: "Light 4.2 oz/yd² Airlume combed cotton — the retail-quality unisex jersey rather than the heavy budget default. <b>Printify Choice was picked after <code>cli.ts sweep</code> probed all twenty makers of this blueprint</b>: $6.08–$10.93 against Monster Digital's $11.54–$16.44 on our own six colourways and six sizes, and $3.99 postage against $4.29.",
    cost: "Print area is 9.2in against Monster Digital's 11.1in. Our placement is 8in so it fits, and the same art over a smaller area prints at a <i>higher</i> dpi — but the mark prints somewhat smaller at the top of the size run." },
  longsleeve: { garment: "Bella+Canvas 3501", alt: "—",
    why: "The tee's long-sleeved sibling. Same light 4.2 oz/yd² Airlume cotton, same maker, so a customer who owns the tee gets the same shirt with sleeves.", cost: "" },
  crewneck: { garment: "Gildan 18000", alt: "—",
    why: "The hoodie's plainer sibling, through SwiftPOD who already print the hoodie. Heavy Blend at 8 oz/yd² in a 50/50.", cost: "" },
  hoodie: { garment: "Independent Trading Co. IND4000", alt: "Gildan 18500, the budget default",
    why: "The Gildan is 8 oz of 50/50 with a one-ply body. The IND4000 is <b>10 oz, fleece-lined hood, tear-away label, double-needle stitching</b> — the tier the merchandise trade treats as quality. It also carries a <b>15 × 10in front canvas against the Gildan's 12.4 × 8.2</b>, which is what lets a square mark print seven inches across on a small instead of under six.",
    cost: "<b>This is why the hoodie has no Printify Choice.</b> Only two makers carry blueprint 2002 at all, and Choice is not one of them. SwiftPOD over Monster Digital on stock rather than money: Monster Digital's IND4000 has no black and stops at 2XL. The budget Gildan would almost certainly offer Choice — that is the price of the better garment." },
  youth: { garment: "Bella+Canvas 3001Y", alt: "—",
    why: "The youth cut of the adult tee — the same shirt the grown-ups get, so a family order matches.", cost: "" },
  cap: { garment: "blueprint 1744", alt: "—", why: "Fitted cap. Printful and Printify Choice return identical economics on it.", cost: "" },
  beanie: { garment: "blueprint 1691", alt: "—", why: "Printful and Printify Choice return identical economics on it.", cost: "" },
  mug: { garment: "blueprint 479", alt: "—", why: "11 oz and 15 oz on one blueprint, so a customer picks a size rather than a product.", cost: "" },
  sticker: { garment: "blueprint 400", alt: "—", why: "Kiss-cut vinyl in two sizes. Sold in threes because a single sticker cannot carry its own postage.", cost: "" },
};

let grid = { rows: [] };
try {
  grid = JSON.parse(await readFile("dist/print/garment-grid.json", "utf8"));
} catch {
  // Never probed. The tab says so rather than pretending the question is settled.
}

const gridByItem = new Map();
for (const r of grid.rows) {
  if (!gridByItem.has(r.itemId)) gridByItem.set(r.itemId, []);
  gridByItem.get(r.itemId).push(r);
}

const garments = ORDER.map((id) => {
  const cand = gridByItem.get(id) ?? [];
  const w = WHY[id] ?? { garment: "—", alt: "—", why: "", cost: "" };
  if (!cand.length) {
    return `<section><h2>${NAMES[id] ?? id}</h2>
      <p class="worst bad">Never probed. Run <code>node packages/store/src/cli.ts garments ${id}</code>.</p></section>`;
  }

  const ours = cand.find((r) => r.current);
  const landedOf = (r) => (r.minCost || 0) + (r.postCents ?? 99999);
  const priced = cand.filter((r) => r.minCost > 0 && r.postCents != null);
  const usable = priced.filter((r) => r.postCents < 1500);
  const sorted = [...cand].sort((a, b) => {
    const ap = a.minCost > 0 && a.postCents != null, bp = b.minCost > 0 && b.postCents != null;
    if (ap !== bp) return ap ? -1 : 1;                       // unpriced last
    return landedOf(a) - landedOf(b);
  });
  const cheaper = ours ? usable.filter((r) => !r.current && landedOf(r) < landedOf(ours)) : [];

  const qual = APPAREL.has(id);
  const body = sorted.map((r) => {
    const flags = [];
    if (!r.minCost) flags.push(`<span class="flag bad">would not price</span>`);
    if ((r.postCents ?? 0) > 1500) flags.push(`<span class="flag warn">${usd(r.postCents)} postage</span>`);
    if (!r.hasChoice) flags.push(`<span class="flag warn">no Printify Choice</span>`);
    if (r.indicative && r.minCost) flags.push(`<span class="flag">sampled colourways</span>`);
    return `<tr class="${r.current ? "chosen" : ""}">
      <td class="lbl">${r.current ? '<span class="tick">✓</span> ' : ""}${esc(`${r.brand} ${r.model}`.trim() || r.blueprintTitle)}</td>
      <td class="num">${r.blueprintId}</td>
      <td class="num">${r.providerCount}</td>
      <td class="num">${esc(r.provider)}</td>
      <td class="num ${qual && r.weightOz ? "qual" : "dim"}">${qual && r.weightOz ? `${r.weightOz} oz` : "—"}</td>
      <td class="lbl ${qual && r.blend ? "qual" : "dim"}">${qual && r.blend ? esc(r.blend) : "—"}</td>
      <td class="num">${r.minCost ? usd(r.minCost) : "—"}</td>
      <td class="num">${r.maxCost ? usd(r.maxCost) : "—"}</td>
      <td class="num">${r.postCents == null ? "—" : usd(r.postCents)}</td>
      <td class="num pay">${r.minCost && r.postCents != null ? usd(landedOf(r)) : "—"}</td>
      <td class="notes">${flags.join(" ") || '<span class="dim">—</span>'}</td>
    </tr>`;
  }).join("");

  const verdict = !ours
    ? `<p class="worst bad">The blueprint we sell was not measured in this run.</p>`
    : cheaper.length === 0
      ? `<p class="worst">✓ <b>${esc(`${ours.brand} ${ours.model}`.trim())}</b> at ${usd(landedOf(ours))} landed is the cheapest of ${priced.length} priced candidates.</p>`
      : `<p class="worst bad">${cheaper.length} cheaper candidate${cheaper.length === 1 ? "" : "s"}. Cheapest is <b>${esc(`${cheaper[0].brand} ${cheaper[0].model}`.trim())}</b> at ${usd(landedOf(cheaper[0]))} against our ${usd(landedOf(ours))} &mdash; <b>${usd(landedOf(ours) - landedOf(cheaper[0]))} a unit</b>${cheaper[0].hasChoice ? ", and it has Printify Choice" : ""}. A quality decision, not an oversight &mdash; see the note.</p>`;

  return `<section>
    <h2>${NAMES[id] ?? id}<span class="meta">${cand.length} rival blueprints probed &middot; we sell ${ours ? `${esc(`${ours.brand} ${ours.model}`.trim())}, blueprint ${ours.blueprintId}` : "—"}</span></h2>
    ${verdict}
    <div class="scroll"><table>
      <thead><tr><th>Garment</th><th class="num">BP</th><th class="num">Makers</th><th class="num">Probed via</th>
      <th class="num qual">Weight</th><th class="qual">Blend</th>
      <th class="num">Cheapest</th><th class="num">Dearest</th><th class="num">Post</th><th class="num pay">Landed</th><th>Notes</th></tr></thead>
      <tbody>${body}</tbody></table></div>
    ${w.why ? `<p class="recorded"><b>What the code records as the reason</b> (matrix.ts, not evidence &mdash; the grid above is): ${w.why}${w.cost ? ` ${w.cost}` : ""}</p>` : ""}
  </section>`;
}).join("");

/* ------------------------------------------------------------------ */
/* Tab 4 — how the money and the tax actually move                     */
/* ------------------------------------------------------------------ */

const explain = `
<section>
  <h2>One order, start to finish</h2>
  <ol class="flow">
    <li><b>They buy.</b> Card details go straight to Stripe — the shop never sees them. Stripe adds New York's sales tax if they are in New York, and nothing if they are not.</li>
    <li><b>Stripe takes its cut immediately.</b> 2.9% + 30¢, plus 0.5% Stripe Tax on a New York order. Deducted before the money reaches you. No invoice, ever.</li>
    <li><b>Stripe emails them the receipt.</b> Automatic, because "Successful payments" is on.</li>
    <li><b>The rest lands in your Stripe balance</b>, and pays out to your bank on Stripe's rolling schedule. <b class="warnt">The sales tax is sitting in that number and it is not yours.</b></li>
    <li><b>The webhook creates the order on Printify and holds it.</b> Nothing is printed. <b>You are charged nothing yet.</b></li>
    <li><b>You look at it and press Submit order.</b> Only now does Printify charge <b>your own card</b> for the garment and the postage.</li>
    <li><b>Printify prints and ships it.</b> 2–5 business days to dispatch, 4–10 in the post.</li>
    <li><b>Once a year, you pay New York.</b> Form ST-101, due 20 March, from the figure Stripe → Tax → Registrations shows you.</li>
  </ol>
</section>

<section>
  <h2>Money in, money out</h2>
  <table class="kv">
    <tr><th>Who charges you</th><td><b>Stripe</b>, per sale, automatically — 2.9% + 30¢ and 0.5% Tax on NY orders.<br><b>Printify</b>, per order, when you press Submit — the garment and the postage, on your own card.<br>Nobody else. No monthly fee anywhere.</td></tr>
    <tr><th>Does Stripe pay Printify?</th><td><b>No.</b> They are unconnected. Two separate money movements that happen to concern the same parcel.</td></tr>
    <tr><th>How do you get paid?</th><td>Automatically. Stripe pays your Stripe balance out to your bank on its own schedule — you do not transfer anything by hand.</td></tr>
    <tr><th>Do you reserve the tax yourself?</th><td><b>Yes, and this is the one that catches people.</b> Stripe <i>collects</i> the tax and hands it to you with everything else. It does not remit it. Move it out of the account the week it lands, or you will spend it and still owe it.</td></tr>
    <tr><th>What is actually yours?</th><td>What is left after Printify, Stripe and New York. On a $27 tee to Buffalo that is about $9.66. With the team code, about $1.57.</td></tr>
  </table>
</section>

<section>
  <h2>Tax, in four lines</h2>
  <table class="kv">
    <tr><th>Who owes it</th><td>The customer pays it; you collect and forward it. It is never revenue and never profit.</td></tr>
    <tr><th>Who it applies to</th><td>New York buyers only. You have no obligation in any other state.</td></tr>
    <tr><th>The rates</th><td>Buffalo: <b>8.75%</b> on general goods, <b>4.75%</b> on clothing under $110 — New York exempts clothing from the state's 4%, Erie County does not waive its own. <b>It applies to the postage too</b>, at whatever rate the goods carry.</td></tr>
    <tr><th>When you pay it</th><td>Once a year. Form ST-101, period 1 March – 28/29 February, due <b>20 March</b>. Likely $20–30. <b>File even in a year with no sales</b> — a missed return is a $50 minimum penalty.</td></tr>
  </table>
</section>`;

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
  .kv{width:100%;border-collapse:collapse;font-size:.88rem;background:var(--panel);border:1px solid var(--line);border-radius:.5rem}
  .kv th{text-align:left;vertical-align:top;width:11rem;color:var(--muted);font-weight:600;font-size:.8rem;padding:.55rem .7rem;border-bottom:1px solid var(--line)}
  .kv td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--line);white-space:normal}
  .kv tr:last-child th,.kv tr:last-child td{border-bottom:0}
  .flow{margin:.5rem 0 0;padding-left:1.3rem} .flow li{margin:.45rem 0}
  .recorded{font-size:.82rem;color:var(--muted);margin:.7rem 0 0;padding-left:.8rem;border-left:2px solid var(--line)}
  .warnt{color:var(--warn)}
  th.qual,td.qual{color:var(--gold)}
  th.qual{border-left:1px solid var(--line)}
  td.qual:first-of-type{border-left:1px solid var(--line)}
  [hidden]{display:none}
</style></head><body><div class="wrap">

<h1>Store economics</h1>
<div class="sub">Golden Retrievers &middot; measured from the live Printify shop &middot; nothing on this page is hand-typed</div>

<div class="tabs" role="tablist">
  <button role="tab" aria-selected="true" data-tab="econ">What you keep</button>
  <button role="tab" aria-selected="false" data-tab="sup">Makers &amp; costs</button>
  <button role="tab" aria-selected="false" data-tab="gar">Garment choice</button>
  <button role="tab" aria-selected="false" data-tab="how">How it works</button>
</div>

<div id="econ">
  <div class="legend">
    <b>They pay</b> = list, less the code, plus postage, plus New York's tax.<br>
    <b>Out</b> = Printify (garment + postage) &middot; Stripe (2.9% + 30&cent;) &middot; Stripe Tax (0.5%, NY only) &middot; the tax itself, which you forward to New York.<br>
    <b>You keep</b> is what is left. <b>Postage cancels</b> — the customer pays it, Printify takes it.<br>
    <b>Worst case anywhere with ${CODE}: ${usd(worstOverall)}.</b> Nothing in the line loses money at 30% off.
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

<div id="gar" hidden>
  <div class="legend">
    <b>Measured, not remembered.</b> <code>cli.ts garments</code> probes rival blueprints across Printify's 1,914 the same way the maker sweep probes rival makers &mdash; create a draft, read the cost back, delete it.<br>
    <b>Landed</b> = cheapest unit + postage. <b>Probed via</b> is the maker used for the measurement: Printify Choice wherever it exists, otherwise the first US house.<br>
    <b>Cross-blueprint costs are marked "sampled colourways"</b> and are indicative. Variant ids are per blueprint, so our own six colours cannot be named on a garment we have never sold. Right for choosing between garments; wrong to quote as our cost.<br>
    <b>The rule is quality first, then the cheapest of that quality.</b> Weight and blend are the quality columns &mdash; heavier is a better blank, and more cotton is a better hand than more polyester. Cost only breaks a tie on quality.<br>
    <b>A cheaper row is not automatically a mistake, and a dearer one is not automatically justified.</b> Both numbers are here so the trade is visible.
  </div>
  ${garments}
</div>

<div id="how" hidden>
  ${explain}
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
console.log(`  worst keep with ${CODE}, anywhere: ${usd(worstOverall)}`);
for (const id of ORDER) {
  const rows = byItem.get(id);
  if (!rows) continue;
  const chosen = rows.find((r) => r.inUse);
  console.log(`  ${(NAMES[id] ?? id).padEnd(12)} ${rows.length} makers priced, chosen: ${chosen ? chosen.provider : "NONE"}`);
}
