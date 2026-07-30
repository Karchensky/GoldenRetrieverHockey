"use client";

import { useEffect } from "react";
import { useCart } from "./Cart";

/**
 * Empty the basket once the customer has paid.
 *
 * **Nothing did this.** `/store/thanks` is a static server component with no
 * effects, so a shopper who had just bought a tee arrived at the thank-you page
 * with that tee still in the basket and "Basket 1" still in the masthead. The
 * next thing they added landed on top of a line they had already paid for, and
 * the count stayed wrong from that point on for the life of the browser.
 *
 * **Clearing here cannot lose an order.** The order is placed by the Stripe
 * webhook, not by this page being reached — the page's own comment says so and
 * it is the reason this is safe. Somebody who closes the tab on the payment
 * screen still gets their parcel; they just keep a stale basket, which the next
 * thing they add will sit beside rather than merge into. That is the tolerable
 * half of the trade, and the only alternative — clearing on redirect out to
 * Stripe — would empty the basket of everyone who backs out without paying.
 *
 * It renders nothing.
 */
export default function ClearBasket() {
  const { clear } = useCart();
  useEffect(() => { clear(); }, [clear]);
  return null;
}
