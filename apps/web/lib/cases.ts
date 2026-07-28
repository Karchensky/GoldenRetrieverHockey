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

/** The rulings that settle who somebody is, on his own page. */
export const casesFor = (name: string): readonly Case[] =>
  data.cases.filter((item) => item.title.endsWith(`— ${name}`));
