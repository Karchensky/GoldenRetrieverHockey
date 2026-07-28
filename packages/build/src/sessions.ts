/**
 * Session labels -> a sortable, comparable session.
 *
 * A season here is a SESSION, not a year: the team plays twice a year, summer
 * and fall/winter, and has since 2013. Four platforms label them four ways —
 * "2017-18 Regular Season", "Summer 2026", "Sum 2024", "2018 Spring/Summer",
 * "Fall/Winter 2021-22". None of them agree.
 *
 * Owner guidance: derive the half from the DATES, not the label — summer runs
 * roughly June to August, fall/winter September to May. Labels are a hint;
 * where a label is unambiguous we trust it, and where it is not the caller
 * supplies a game date.
 */

export type Half = "summer" | "fall-winter";
export type ParsedSession = {
  /** For a league half, the year the session STARTED (fall/winter 2014-15 is
   *  2014). For a tournament, the calendar year it was PLAYED. */
  year: number;
  half: Half;
  sort: number;
  /** Canonical tournament name, when this session is a tournament rather than
   *  a league half. Null/absent for the leagues. See TOURNAMENTS. */
  tournament?: string;
};

/**
 * TOURNAMENTS ARE SESSIONS. The captain's ruling, verbatim:
 *
 *   "Tournaments can be their own little mini-seasons. We can capture this
 *    data & it just fits in chronologically whenever the tournament took
 *    place."
 *
 * They are not league halves, so they cannot be placed by the summer /
 * fall-winter rules above — a four-day event has no half. Each is placed by
 * the month it is actually played, and that month is a FACT OFF THE
 * TOURNAMENT'S OWN PAGE, not a guess.
 *
 * `match` is deliberately loose about the name because the sources shout it
 * differently — the team's own home page renders it
 * "gREATER bUFFALO iNVITATIONAL", its trophy case calls it "GB Tournament",
 * the captain's statistics workbook heads the block "GB Invitational 2016",
 * and Performax's own page calls it the "Greater Buffalo Senior Hockey
 * Invitational". All four are one event. It must also match this table's own
 * output ("2015 - Greater Buffalo Invitational"), because a session label is
 * re-parsed downstream and has to round-trip.
 *
 * The fourth spelling is why this is an alternation and not a string. Without
 * `GB Invitational`, the workbook's three tournament blocks parse as bare years
 * — 2014, 2015, 2016 — and file thirty-five tournament lines into three summer
 * LEAGUE halves, two of which the same workbook also holds. That is the bug
 * this file's header warns will recur, arriving from a new direction.
 */
const TOURNAMENTS: { match: RegExp; name: string; month: number }[] = [
  {
    // performaxsports.com/greater-buffalo-shi/, captured 20160423012111 and
    // 20160818165458: "Performax Hockey Presents the 32nd Annual Greater
    // Buffalo Senior Hockey Invitational — April 27th - May 1st — Northtown
    // Center of Amherst". A spring event, not a summer one.
    match: /greater\s+buffalo(\s+senior\s+hockey)?\s+invitational|\bGB\s+(Tournament|Invitational)\b|\bGBHI\b/i,
    name: "Greater Buffalo Invitational",
    month: 4,
  },
];

/**
 * Both spellings, because the corpus only ever uses one of them and it is not
 * the one this table originally had.
 *
 * MONTHS held full names only. Every scoresheet in the archive writes "Sep 19,
 * 2016", so parseGameDate returned null for all 65 of them, resolveSession
 * silently fell back to the label on every call, and the owner's explicit
 * instruction -- derive the half from the DATES, not the label -- has never
 * once executed. Nothing failed; the override just quietly did not exist. The
 * docstring's own example, "July 13, 2026", is a format this archive does not
 * contain.
 *
 * "may" is deliberately in both lists: it is the one month whose abbreviation
 * is the whole word, and it was the ONLY date this function has ever parsed --
 * by coincidence.
 */
const MONTHS: Record<string, number> = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6,
  jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12,
};

/** Summer ≈ June–August; fall/winter ≈ September–May. */
export function halfFromMonth(month: number): Half {
  return month >= 6 && month <= 8 ? "summer" : "fall-winter";
}

/** "Sep 19, 2016" or "July 13, 2026" -> {year, month}. Null if unrecognisable. */
export function parseGameDate(s: string): { year: number; month: number } | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+\d{1,2},\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  return { year: Number(m[2]), month };
}

/**
 * Read a session label from any of the four platforms.
 *
 * `sort` orders sessions chronologically: the fall/winter half of a year
 * follows its summer, so summer 2021 = 2021.0 and fall/winter 2021-22 = 2021.5.
 */
export function parseSessionLabel(label: string): ParsedSession | null {
  const s = label.trim();

  // TOURNAMENTS FIRST, so a tournament whose name happens to contain "Summer"
  // or "Spring" is never mistaken for a league half.
  //
  // A tournament sorts a QUARTER-STEP AFTER the league half it was played in:
  // the Greater Buffalo Invitational runs late April, which falls inside the
  // fall/winter half that started the previous September, so the 2015 edition
  // lands at 2014.75 — immediately after "2014 - Winter", the season it capped,
  // and immediately before "2015 - Summer".
  //
  // WHY A QUARTER-STEP RATHER THAN A HALF OF ITS OWN. The season record is read
  // top to bottom as one chronology. Giving tournaments their own half would
  // put a four-day event beside a twenty-five-game season as an equal; giving
  // them the SAME sort as the half they sit in would collide two different
  // competitions on one key, which is the bug this file exists to prevent. A
  // quarter-step keeps every league half exactly where it was, never collides,
  // and always renders the tournament immediately after the season it ended —
  // which is where it happened.
  const t = TOURNAMENTS.find((x) => x.match.test(s));
  const tYear = t ? s.match(/(\d{4})/)?.[1] : undefined;
  if (t && tYear) {
    const year = Number(tYear);
    const half = halfFromMonth(t.month);
    // The half this date belongs to, by the same rule `resolveSession` uses:
    // a January-to-May date belongs to the fall/winter session that STARTED
    // the prior year.
    const base =
      half === "summer" ? year : t.month <= 5 ? year - 1 + 0.5 : year + 0.5;
    return { year, half, sort: base + 0.25, tournament: t.name };
  }

  // Canonical display form: "2026 - Summer" | "2025 - Winter".
  const canonical = s.match(/^(\d{4})\s*-\s*(summer|winter)$/i);
  if (canonical) {
    const year = Number(canonical[1]);
    const half: Half = canonical[2]!.toLowerCase() === "summer" ? "summer" : "fall-winter";
    return { year, half, sort: half === "summer" ? year : year + 0.5 };
  }

  // "Summer 2026" | "Sum 2024" | "2026 Summer" | "2018 Spring/Summer ..."
  const summer = s.match(/(?:^|\s)(?:summer|sum|spring\/summer)\s+(\d{4})/i)
              ?? s.match(/(\d{4})\s+(?:summer|sum|spring\/summer)/i);
  if (summer) {
    const year = Number(summer[1]);
    return { year, half: "summer", sort: year };
  }

  // "2021 Spring HAHL Regular Season" — bare Spring, no "/Summer". HAHL ran it
  // exactly once, when the rinks reopened after the winter that never happened:
  // it was in play in April 2021, which is the fall/winter window, so it is
  // filed as the fall/winter half of the PRIOR year — the same slot
  // `resolveSession` gives its game dates ("a January game belongs to the
  // fall/winter session that STARTED the prior year"). "2021 Spring" is the
  // 2020-21 session, sort 2020.5, displayed "2020 - Winter".
  //
  // THE CAPTAIN HAS RULED ON THIS ONE, verbatim: "You are right, it is a real
  // session, it just started in March of 2021. We can call in Winter 2020 still
  // for consistency.. it just started late, and was severely shortened."
  //
  // So it stays here, under this label and this sort, and the reason it looks
  // wrong is worth writing down where the next reader will find it: THIS
  // SESSION RAN ROUGHLY MARCH TO APRIL 2021, not September to March. Everything
  // odd about it follows from that — eight games where a winter has twenty-odd,
  // and a standings row captured 20 April 2021 that is still not final, which
  // is the shape of a season that started late and was cut short rather than of
  // a season nobody recorded. Its roster survives in the captain's email for
  // the session, the one roster in this archive that separates the rostered
  // from the taxi squad and the injured.
  //
  // THE LINE BELOW IS THE WHOLE RULING. If the captain ever files it elsewhere,
  // change the year/half here and nothing else. Checked AFTER the summer branch
  // so "Spring/Summer" — HAHL's name for its summers — never lands here; the
  // lookahead keeps "2019 Spring/Summer" out even if that order ever changes.
  const spring = s.match(/(?:^|\s)spring(?!\s*\/)\s+(\d{4})/i)
              ?? s.match(/(\d{4})\s+spring(?!\s*\/)/i);
  if (spring) {
    const year = Number(spring[1]) - 1;
    return { year, half: "fall-winter", sort: year + 0.5 };
  }

  // "Fall/Winter 2021-22" | "2021-22 Regular Season" | "2025-26"
  const span = s.match(/(\d{4})\s*[-/–]\s*(\d{2,4})/);
  if (span) {
    const year = Number(span[1]);
    return { year, half: "fall-winter", sort: year + 0.5 };
  }

  // "Winter 2013" | a bare year, e.g. "2018-19 Fall/Winter" already caught above
  const bare = s.match(/(?:^|\s)(?:winter|fall)\s+(\d{4})/i) ?? s.match(/^(\d{4})$/);
  if (bare) {
    const year = Number(bare[1]);
    return { year, half: "fall-winter", sort: year + 0.5 };
  }
  return null;
}

/**
 * The session for a label, corrected by a game date when one is available.
 *
 * The date WINS. Labels lie: "2018 Spring/Summer" and "Sum 2024" and
 * "Summer 2026" are the same shape of thing described three ways, and at
 * least one platform files a summer session under a hyphenated year.
 */
export function resolveSession(label: string, gameDate?: string): ParsedSession | null {
  const fromLabel = parseSessionLabel(label);
  if (!gameDate) return fromLabel;
  const d = parseGameDate(gameDate);
  if (!d) return fromLabel;

  const half = halfFromMonth(d.month);
  // A fall/winter session spans two calendar years; its "year" is the first.
  const year = half === "fall-winter" && d.month <= 5 ? d.year - 1 : d.year;
  return { year, half, sort: half === "summer" ? year : year + 0.5 };
}

/** A stable, human display label. Must round-trip through parseSessionLabel. */
export function sessionLabel(p: ParsedSession): string {
  if (p.tournament) return `${p.year} - ${p.tournament}`;
  return `${p.year} - ${p.half === "summer" ? "Summer" : "Winter"}`;
}
