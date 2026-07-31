import type { Metadata } from "next";
import Link from "next/link";
import s from "../../../components/store/store.module.css";

/**
 * Shipping, and how to reach a person.
 *
 * **A shop that takes money owes the buyer this page** — what it costs, how
 * long it takes, and who to write to. Stripe expects it and the card networks
 * expect it.
 *
 * **Every figure here is measured, not aspirational.** The 2–5 business day
 * window is Printify's own `handlingTime` for the standard plan, read from the
 * API on 2026-07-29 and identical across every item. The postage arithmetic is
 * the live basket quote.
 *
 * **IT STATES NO RETURNS POLICY, DELIBERATELY.** It used to: misprints replaced
 * free, a 30-day photograph window, cancellation before production. Those are
 * PRINTIFY's terms, and restating a supplier's terms as our own commits a
 * one-person shop to honouring them out of a margin that cannot absorb it — on
 * any order where Printify happens to decide differently, the promise is still
 * on this page and the bill is his. The captain removed it on 2026-07-31.
 *
 * What replaces it is the only commitment that is unconditionally within his
 * gift: write to him, and he will work it out. That is worth more to a customer
 * than a policy, and it cannot be held against him at a chargeback the way a
 * printed guarantee can.
 *
 * **Nothing here is written for effect.** An earlier version closed paragraphs
 * with lines like "Nothing is missing — the rest is still coming" and "This is
 * the honest bit". The captain: *"The facts have already been delivered, we
 * don't need these little witty additions. It's not a marvel movie."* State the
 * fact and stop.
 */

/**
 * **This address has to exist before the store opens.**
 *
 * It is deliberately NOT a personal inbox: the captain's own email should not be
 * on a public page, and a shop address outlives whoever is reading it. Cloudflare
 * Email Routing forwards this to any real mailbox for free — same dashboard the
 * site is already deployed from, no mail server involved. See MANUAL.md §1.
 */
const CONTACT = "store@goldenretrieverhockey.com";

export const metadata: Metadata = {
  title: "Shipping and returns",
  description:
    "How long an order takes, what happens if something arrives wrong, and how to " +
    "reach a person about it.",
};

export default function HelpPage() {
  return (
    <div className="wrap page">
      <header className="hero seq">
        <p className="crumb">
          <Link href="/store">Store</Link>
        </p>
        <h1 className="hero-h">
          Shipping
          <br />
          <i>and returns.</i>
        </h1>
        <p className="hero-p">
          Everything here is printed to order — made after you buy it, not pulled off
          a shelf.
        </p>
      </header>

      <section data-reveal>
        <h2 className="head">How long it takes</h2>
        <table className={s.specTable}>
          <tbody>
            <tr>
              <td />
              <td>
                <b>2 to 5 business days</b> to make it. Every item in the shop is
                printed, stitched or pressed once your order reaches the maker.
              </td>
            </tr>
            <tr>
              <td />
              <td>
                <b>Then the post.</b> Standard US shipping, which is typically a few
                more days depending on how far you are from where it was made.
              </td>
            </tr>
            <tr>
              <td />
              <td>
                <b>Orders with more than one kind of thing may arrive separately.</b>{" "}
                A cap and a mug are made in different places, so they are posted from
                different places.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section data-reveal>
        <h2 className="head">What shipping costs</h2>
        <p className={s.detailCopy}>
          <b>Whatever it actually costs us, and not a cent more.</b> The exact postage
          for your order is worked out at checkout and passed straight through — we do
          not mark it up and we do not hide it inside the prices.
        </p>
        <p className={s.detailCopy}>
          That is worth knowing because <b>a second of the same thing ships far
          cheaper than the first</b>. One tee is $4.75 to post; two are $7.15, not
          $9.50. Three stickers cost the same to post as one, which is why they are
          sold in threes and why the three can be three different designs.
        </p>
        <p className={s.detailCopy}>
          Different kinds of thing do not combine that way — a cap and a mug are made
          in different places and each carries its own postage.
        </p>
        <p className={s.detailCopy}>
          We do not ship outside the United States yet.
        </p>
      </section>

      {/* NO STATED RETURNS POLICY, on the captain's instruction.
          This page carried one: misprints replaced free, a 30-day photograph
          window, no need to send the faulty item back, cancellation before
          production. All of it was true of PRINTIFY's policy, and that was the
          mistake — stating a supplier's terms as ours commits a one-person shop
          to honouring them out of a margin that cannot absorb it, whatever
          Printify decides in any individual case. "I don't want to hard-define
          a policy when we basically have no margins & i am just doing this for
          friends for the most part."
          So this says the one thing that is unconditionally true and within his
          gift: write to him and he will sort it out. */}
      <section data-reveal>
        <h2 className="head">If something goes wrong</h2>
        <p className={s.detailCopy}>
          Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and tell us what
          happened. Include your order number and a photograph if there is something
          to see.
        </p>
        <p className={s.detailCopy}>
          This is one person running a store for a hockey team, not a returns
          department. Nothing here is automated and there is no policy to argue with —
          if something has gone wrong we will work it out with you.
        </p>
        <p className={s.detailCopy}>
          Worth knowing: each item is made for you after you order it, so there is no
          stock for it to go back to. Check the measurements on the product page
          before you choose a size.
        </p>
      </section>

      <section data-reveal>
        <h2 className="head">Payment and tax</h2>
        <p className={s.detailCopy}>
          Card payments are handled by Stripe. Nothing about your card touches this
          site or is stored by it.
        </p>
        <p className={s.detailCopy}>
          New York sales tax is added at checkout where it applies. Clothing under
          $110 is taxed at the local rate only; mugs and stickers at the full rate.
          Orders outside New York are not taxed.
        </p>
      </section>

      <section data-reveal>
        <h2 className="head">Reaching a person</h2>
        <p className={s.detailCopy}>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          <br />
          Golden Retrievers · Buffalo, New York
        </p>
        <p className={s.detailCopy}>
          Include your order number — it is on the receipt Stripe emailed you. One
          person reads this, so give it a day or two.
        </p>
      </section>
    </div>
  );
}
