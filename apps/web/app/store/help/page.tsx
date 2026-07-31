import type { Metadata } from "next";
import Link from "next/link";
import s from "../../../components/store/store.module.css";

/**
 * Shipping, returns, and how to reach a person.
 *
 * **A shop that takes money owes the buyer this page**, and until now the site
 * had nothing of the kind: no stated production time, no returns position, no
 * address to write to when a parcel arrives wrong. Stripe expects it, the card
 * networks expect it, and a customer deciding whether to spend $74 on a hoodie
 * from a hockey team's website is entitled to know what happens if it turns up
 * the wrong size.
 *
 * **Every figure here is measured, not aspirational.** The 2–5 business day
 * production window is Printify's own `handlingTime` for the standard shipping
 * plan, read from the API on 2026-07-29 and identical across all six items. The
 * returns position is the one Printify's own policy leaves available: they
 * reprint their faults, and they charge for a customer's change of mind, so
 * this page says exactly that rather than promising a free-returns programme
 * somebody would have to fund out of a $13 margin.
 *
 * There is no invented policy on this page. If it is not stated here it is
 * because it has not been decided — and an undecided policy is better absent
 * than guessed at, because this is the page a chargeback gets judged against.
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
          a shelf. That is what makes a twelve-person team&rsquo;s store possible, and it
          is the reason for most of what follows.
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
                different places. Nothing is missing — the rest is still coming.
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
          in different places and each carries its own postage. Nothing we can do about
          that, but you only ever pay the real figure.
        </p>
        <p className={s.detailCopy}>
          We do not ship outside the United States yet.
        </p>
      </section>

      <section data-reveal>
        <h2 className="head">If something arrives wrong</h2>
        <p className={s.detailCopy}>
          <b>Anything misprinted, damaged or defective is replaced free.</b> Send a
          photograph within 30 days of it arriving and a new one goes out. You do not
          need to post the faulty one back.
        </p>
        <p className={s.detailCopy}>
          The same goes for an order that never turns up, or turns up as the wrong
          item or the wrong size from what you ordered.
        </p>
      </section>

      <section data-reveal>
        <h2 className="head">If you ordered the wrong size</h2>
        <p className={s.detailCopy}>
          This is the honest bit. Because each item is made for you specifically,
          there is no stock to return it to and no one else it fits. So{" "}
          <b>we cannot take back a correctly-made item that you have changed your mind
          about</b>, and a size you picked yourself counts as that.
        </p>
        <p className={s.detailCopy}>
          Write to us anyway. It is a hockey team, not a corporation, and if something
          has genuinely gone wrong we would rather sort it out than win an argument
          about whose fault it was. Check the measurements on the product page before
          you order and it should not come up.
        </p>
      </section>

      <section data-reveal>
        <h2 className="head">Cancelling</h2>
        <p className={s.detailCopy}>
          An order can be cancelled for a full refund any time before it goes into
          production. That is usually a window of several hours, occasionally less.
          Write immediately and we will stop it if it has not started.
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
