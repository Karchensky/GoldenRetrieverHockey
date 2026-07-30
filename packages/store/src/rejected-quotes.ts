/**
 * EVERY LINE THE CAPTAIN HAS TURNED DOWN. Nothing here may ever be printed.
 *
 * This file exists because the same rejected quotes came back three times. Not
 * because anyone re-approved them — because a rejection lived only in a chat
 * message, and a chat message is not a constraint. He rewrote the same list of
 * denials twice and then wrote "these are rejected stop showing me these
 * please", which is the correct response to a system that forgets.
 *
 * So a rejection is now a fact in the repo, and `test/quotes.test.ts` fails the
 * build if a line in this list turns up in `QUOTES`. Recycling one is no longer
 * a thing anybody has to notice.
 *
 * WHY THE TEXT AND NOT THE PRODUCT ID: the same line was offered on a different
 * garment more than once, so keying by product would have let it through by
 * moving. What was rejected is the sentence.
 *
 * MATCHING IS ON NORMALISED TEXT — curly quotes folded to straight, case and
 * punctuation-spacing ignored — because these were transcribed by hand out of a
 * rendered page and the apostrophes do not survive that trip. The check is on
 * the quoted line only, never the attribution: he has moved a line from one
 * player to another, and that is an edit, not a resurrection.
 *
 * TO REVIVE ONE: delete it from this list. That is a deliberate act with his
 * name on it, which is the point.
 */

/** Fold to the form the comparison runs on. Exported so the test uses the same one. */
export function normaliseQuote(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

/**
 * Rejected 2026-07-29, from the first review page. Mostly bare film catchphrases
 * with a hockey word swapped in, and dog-obedience puns.
 */
const FIRST_ROUND = [
  "Boop.",
  "He's the hero TGR deserves.",
  "Good boy. Bad penalty.",
  "Bring it back. Every time. That's the whole sport.",
  "Bred to retrieve. Trained to backcheck.",
  "There's no crying in beer league.",
  "Fetch is just a breakout drill with extra steps.",
  "Fetch, but for adults with jobs.",
  "Some are born great. Some achieve greatness. Some get put on the power play.",
  "Say hello before you say anything else.",
  "That escalated quickly.",
  "Good dogs carry their own equipment.",
  "You're killin' me, Smalls.",
  "Start them young. They'll be better than us by Tuesday.",
  "First rule: boop, then battle.",
  "Though she be but little, she is fierce.",
  "Are you not entertained?",
  "I feel the need. The need for a line change.",
];

/**
 * Rejected 2026-07-30, from the replacements written for the first round. Same
 * two failure modes, which is the lesson: the second attempt drifted straight
 * back into film-quote-with-a-hockey-noun and heel/sit/shake wordplay.
 */
const SECOND_ROUND = [
  "Shake, then shake hands.",
  "Man's best friend, and the league's worst matchup.",
  "Good dogs come when called. Great dogs are already in the slot.",
  "Uneasy lies the head that wears the C.",
  "You had me at ice time.",
  "We came, we saw, we got a point out of it.",
  "Wag more, slash less.",
  "We heel. We also cycle.",
  "Lord, what fools these forwards be.",
  "Life moves pretty fast. So does the rush.",
  "You cannot teach an old dog a new toe-drag. We tried.",
  "Puppy eyes work on referees roughly never.",
  "Say hello to my little backhand.",
  "Great Scott, that was offside.",
  "The dog on the front of this does more backchecking than I do.",
  "Who let the dogs out? Coach did. On a line change.",
  "I will be back. Second period.",
];

/**
 * Rejected earlier, before the review pages existed — struck by name in chat.
 * Kept so the rule is one rule and not "the list, plus whatever I remember".
 */
const BY_NAME = [
  "The cat's gotta stick together.",
  "Buffalo's premium hockey club.",
];

export const REJECTED_QUOTES: readonly string[] = [
  ...FIRST_ROUND,
  ...SECOND_ROUND,
  ...BY_NAME,
];

/** Normalised, for a fast lookup. Built once. */
export const REJECTED_NORMALISED: ReadonlySet<string> = new Set(
  REJECTED_QUOTES.map(normaliseQuote),
);
