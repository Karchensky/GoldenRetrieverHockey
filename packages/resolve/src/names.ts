/**
 * Name comparison for identity resolution.
 *
 * This module decides whether two recorded names are the same human. Getting
 * it wrong in one direction leaves one man split across four spellings; in the
 * other it MERGES THREE BROTHERS INTO ONE PERSON and erases two of them from
 * their own team's history. The second failure is worse and is not recoverable
 * by a later pass, so every rule here is biased against merging.
 *
 * The governing evidence (owner-confirmed, §2.5):
 *   MERGE:     Vinny Terrara / Vinny Terana / Vincent Terrana / Vinny Terrana  (all #89, one man)
 *              Corey Muff / Coroy Muff / Cory Muff                             (one goalie)
 *              Jay Kaplewicz / Jason Kaplewicz                                 (nickname)
 *              Brenden Kaplewicz / Brendan Kaplewicz                           (spelling)
 *   NEVER:     Adam Kaplewicz / Jason Kaplewicz / Brendan Kaplewicz            (three brothers)
 *              Greg Suffoletto / Alex Suffoletto                               (two brothers)
 */

/**
 * Damerau-Levenshtein distance: insertion, deletion, substitution AND
 * TRANSPOSITION, each costing 1.
 *
 * Transposition must cost 1, not 2. Plain Levenshtein scores "John"/"Jonh" as
 * distance 2 and so refuses to merge them — but a transposition is exactly
 * what a typist produces, and this archive is full of them: Jonh Rein,
 * Stienmetz, Coroy Muff. Treating one slip of the fingers as two edits leaves
 * real people split across spellings.
 *
 * Small inputs; clarity over cleverness.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Full matrix: transposition needs the row before last.
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        d[i - 1]![j]! + 1, // deletion
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );
      // Transposition of two adjacent characters.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

/**
 * Nicknames -> the registered given name.
 *
 * Deliberately a small, EXPLICIT, evidence-backed table rather than a general
 * nickname database. A broad list would eventually equate two given names that
 * belong to two real brothers. Every entry here is a pair actually observed in
 * this archive.
 */
export const NICKNAMES: Readonly<Record<string, string>> = Object.freeze({
  vinny: "vincent",
  vin: "vincent",
  jay: "jason",
  rich: "richard",
  richie: "richard",
  dan: "daniel",
  danny: "daniel",
  greg: "gregory",
  mike: "michael",
  matt: "matthew",
  tony: "anthony",
  bob: "robert",
  rob: "robert",
  jim: "james",
  joe: "joseph",
  drew: "andrew",
  andy: "andrew",
  brent: "brent",
});

/** Lowercase, strip punctuation and accents, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type NameParts = { given: string; surname: string };

/** Split "Vinny Terrana" -> { given: "vinny", surname: "terrana" }. */
export function splitName(full: string): NameParts {
  const parts = normalize(full).split(" ").filter(Boolean);
  if (parts.length === 0) return { given: "", surname: "" };
  if (parts.length === 1) return { given: "", surname: parts[0]! };
  return { given: parts[0]!, surname: parts.slice(1).join(" ") };
}

/** Resolve a nickname to its registered form. */
export function canonicalGiven(given: string): string {
  const g = normalize(given);
  return NICKNAMES[g] ?? g;
}

/**
 * Do two GIVEN names refer to the same person?
 *
 * Tolerates nicknames (Vinny/Vincent, Jay/Jason) and one-character spelling
 * variance (Brenden/Brendan), and NOTHING more. This is the tightest rule in
 * the system on purpose: it is the veto that keeps the Kaplewicz brothers
 * three people. Widening it is how you delete a teammate.
 */
export function givenNamesMatch(a: string, b: string): boolean {
  const ca = canonicalGiven(a);
  const cb = canonicalGiven(b);
  if (!ca || !cb) return false; // an absent given name proves nothing
  if (ca === cb) return true;
  // One typo apart — a substitution, a dropped letter, or a transposition
  // (Corey/Cory, John/Jonh). Names of 3 characters get NO tolerance, because
  // one edit is most of the word there: "Jay"/"Ray" and "Dan"/"Ian" are
  // different people, not typos.
  //
  // Safe for the sibling veto by a wide margin: the Kaplewicz brothers are
  // 5-6 edits apart (adam/jason = 5, jason/brendan = 6), nowhere near this
  // threshold. Verified by test.
  return editDistance(ca, cb) <= 1 && Math.min(ca.length, cb.length) >= 4;
}

/**
 * Do two SURNAMES refer to the same family name?
 *
 * Looser than given names, because surnames are what volunteer scorekeepers
 * misspell: Terrana/Terrara/Terana, Steinmetz/Stienmetz, Kaczynski/Kacznski.
 * Being loose here is SAFE only because a given-name conflict vetoes the merge
 * regardless — all three Kaplewiczes share a surname and must stay separate.
 */
export function surnamesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const d = editDistance(na, nb);
  const len = Math.min(na.length, nb.length);
  if (len <= 4) return d <= 1;
  return d <= 2;
}

export type MatchVerdict = {
  match: boolean;
  /** Why — for the review queue. Never merge without a stated reason. */
  reason: string;
};

/**
 * Are two recorded names the same person?
 *
 * A given-name CONFLICT is an absolute veto: no surname similarity, jersey
 * agreement or shared roster may override it (§2.5). That single rule is what
 * stands between this archive and the erasure of two Kaplewicz brothers.
 */
export function namesMatch(a: string, b: string): MatchVerdict {
  const pa = splitName(a);
  const pb = splitName(b);

  if (!surnamesMatch(pa.surname, pb.surname)) {
    return { match: false, reason: `different surname: ${pa.surname} vs ${pb.surname}` };
  }
  if (!givenNamesMatch(pa.given, pb.given)) {
    // The veto. Same family, different person.
    return {
      match: false,
      reason: `given-name conflict vetoes merge despite matching surname: ${pa.given} vs ${pb.given}`,
    };
  }
  const ca = canonicalGiven(pa.given);
  const nickname = ca !== pa.given || ca !== canonicalGiven(pb.given);
  const spelling = pa.surname !== pb.surname;
  const why = [
    nickname ? "nickname resolved" : null,
    spelling ? `surname spelling (${pa.surname}/${pb.surname})` : null,
  ].filter(Boolean);
  return {
    match: true,
    reason: why.length ? why.join(" + ") : "exact",
  };
}
