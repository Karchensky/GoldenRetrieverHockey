import type { Case } from "../../../packages/build/src/types";
import { data, sessions } from "./data";

/**
 * THE ARCHIVE'S OWN RULINGS, ON THE SEASONS THEY WERE MADE ABOUT.
 *
 * `site.json` has carried five adjudications since the corpus was first built
 * and nothing on the site read them. Two are substantive: for 2013 - Summer and
 * 2014 - Winter the captain's workbook and the archived page state the same
 * table differently, and the wider of the two disputes moves the biggest career
 * in the file by 43 points. Both seasons render on the rail and on their own
 * pages as settled numbers. Publishing the outcome and hiding the ruling is the
 * one thing this archive says it does not do.
 *
 * The session is read out of the title, which is where the build wrote it —
 * "Matter of the unfinished table — 2013 - Summer, regular season". The three
 * alias matters name a player rather than a season and are reached from the
 * name they settle.
 */
export type SessionCase = Case & { session: string };

const SESSION_IDS: readonly string[] = sessions.map((session) => session.id);

export const CASES: readonly SessionCase[] = data.cases.flatMap((item) => {
  const session = SESSION_IDS.find((id) => item.title.includes(id));
  return session ? [{ ...item, session }] : [];
});

/* THE THREE ALIAS MATTERS ARE NO LONGER READ BY ANYTHING.
   `casesFor(name)` returned the rulings that settle who somebody is and the
   player page printed them under `On the record`. They came off on 2026-08-04:
   a ruling on how a man's name is spelled across four sources is an account of
   reconciling the corpus, not something his own page should adjudicate in
   front of him. The lookup goes with the section rather than sitting here
   exported and uncalled.
   They are still IN `site.json` — the record of how these pages were arrived
   at does not shrink because the site stopped printing part of it. `CASES`
   above still reaches the two that turn on figures. */
