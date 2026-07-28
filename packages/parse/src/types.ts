/**
 * Parsed shapes. Deliberately CLOSE TO THE SOURCE — this layer's job is to
 * read bytes faithfully, not to interpret, normalise, or resolve identity.
 *
 * Two rules from the spec govern everything here:
 *
 * - **Never coerce unknown to zero (§2.4).** Stats stay as raw strings, and
 *   an absent column is absent — not `0`. Whether a column was tracked at all
 *   varies by league and era, and a missing value that becomes `0` silently
 *   corrupts every career total downstream.
 * - **Identity is NOT resolved here (§2.5).** A `PlayerSeason` is a
 *   player-on-a-team-in-a-season, exactly as SportsEngine models it. Deciding
 *   that two of these are the same human is sub-project 3's job, and it needs
 *   evidence this layer must not throw away.
 */

/** A phase of a season: regular season, playoffs — or an aggregate of them. */
export type Phase = {
  /** The row's own label, verbatim: "Regular Season", "2017-18 Playoff". */
  label: string;
  /**
   * True for rows like "2017-18 Totals" / "Summer League 2019 Totals".
   *
   * These are AGGREGATES, not phases (§2.8.1). Ingesting one as a session
   * invents a phantom season AND double-counts every stat in it. Kept rather
   * than dropped so §9 can reconcile them against the sum of the real phases.
   */
  isAggregate: boolean;
  /** Which stat vocabulary this row uses. Goalie and skater tables differ. */
  kind: "skater" | "goalie";
  /**
   * Column -> raw value, verbatim. Never parsed to numbers here: "6.45",
   * "990:00" and "" each mean something, and "" is NOT zero.
   */
  stats: Record<string, string>;
};

/** One player, on one team, in one season, as the source records them. */
export type PlayerSeason = {
  /** Team name AS RECORDED. Name variants are preserved, never normalised. */
  team: string;
  /** Session label verbatim: "2016-17 Regular Season", "2018 Spring/Summer". */
  session: string;
  /** Jersey number as a string: "0" and "A15" both occur. */
  jersey: string;
  /** Name AS RECORDED, misspellings intact — they are evidence, not noise. */
  name: string;
  /** "F", "D", "G", "F / D" — or null when the source omits it. */
  position: string | null;
  /**
   * Date of birth, verbatim, when present.
   *
   * The single strongest disambiguator available: it separates the Kaplewicz
   * and Suffoletto siblings, whom no name- or number-based rule can (§2.5).
   */
  dob: string | null;
  /** Listed weight, when present. */
  weight: string | null;
  phases: Phase[];
};
