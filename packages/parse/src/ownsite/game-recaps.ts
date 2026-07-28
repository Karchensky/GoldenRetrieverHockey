export type RecapGame = {
  number: string;
  date: string;
  opponent: string;
  grScore: number;
  opScore: number;
  recap: string | null;
  isPlayoff: boolean;
};

/**
 * A game AS THE CLUB'S OWN PAGE LISTED IT — including the ones it never gave
 * a score.
 *
 * `parseGameRecaps` below returns only the games that have a score, because
 * that is what `site.json.recaps` has always been and the season pages render
 * it. This is the fuller reading, and the game record is built from it: two
 * games on that page were PLAYED and their scores were never written down,
 * and dropping them loses a fact the archive can prove.
 *
 * The 25 March 2013 playoff opener against "Neth & Sons / Encore" is listed
 * the day before it was played and never written up. Championship Game #3 on
 * 10 April prints a Justin Wheeler quote where the score belongs: "Who knew
 * that a bunch of potatoes dressed up as ice hockey players would be so
 * tough." The captain's statistics workbook independently counts six playoff
 * games for Winter 2012/13; the page names all six and scores four.
 */
export type RecapFixture = {
  /** "23", or "Championship 1" where the page prefixed the round. */
  number: string;
  /**
   * The section heading standing over this game — "Playoffs", "Regular
   * Season" — or null on the captures that print none.
   *
   * IT IS THE ONLY THING THAT KNOWS the 25 March game was a playoff. The page
   * numbers the playoffs from one, so its "Game 1: March 25" is a playoff
   * game with the same shape as the regular season's "Game 1: September 24",
   * and telling them apart from the row alone is impossible. Getting it wrong
   * is not cosmetic: the build detects a new SESSION by the numbering
   * restarting, so a playoff Game 1 read as a regular-season Game 1 starts a
   * season that never happened.
   */
  section: string | null;
  /** "February 16" — the page never writes a year. */
  date: string;
  opponent: string;
  /** Null where the page prints no score. Absence is not nought (§2.4). */
  grScore: number | null;
  opScore: number | null;
  recap: string | null;
  isPlayoff: boolean;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A line that is a section heading and nothing else. */
const SECTION = /^(Playoffs|Regular Season)\s*:?\s*$/i;

export function parseRecapFixtures(html: string): RecapFixture[] {
  const clean = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(clean)
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const games: RecapFixture[] = [];
  let section: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const sectionM = lines[i]!.match(SECTION);
    if (sectionM) {
      section = sectionM[1]!.replace(/\s+/g, " ");
      // Spell it as the page's own headings do, whatever case they arrive in.
      section = section[0]!.toUpperCase() + section.slice(1);
      i++;
      continue;
    }

    const gameM = lines[i]!.match(
      /^(?:(Championship|Semi[- ]?(?:final)?)\s+)?Game\s*(?:#\s*)?(\d+|[A-Z]):\s*(.+?)\s+vs\.?\s+(.+)$/i,
    );
    if (!gameM) { i++; continue; }

    const isPlayoff = !!gameM[1] || /^playoffs$/i.test(section ?? "");
    const number = gameM[1] ? `${gameM[1]} ${gameM[2]}` : gameM[2]!;
    const date = gameM[3]!.trim();
    const opponent = gameM[4]!.trim();

    let grScore: number | null = null;
    let opScore: number | null = null;
    // Where the write-up starts when no score is printed: the line straight
    // after the fixture, which is where the quote sits on Championship #3.
    let scoreEnd = i + 1;

    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (/^(?:Championship|Semi|Game\s+\d)/i.test(lines[j]!)) break;
      const scoreM = lines[j]!.match(
        /^(?:The\s+)?Golden\s+Retrievers:\s*(\d+)$/i,
      );
      if (scoreM) {
        grScore = Number(scoreM[1]);
        const nextScoreM = lines[j + 1]?.match(/^(.+?):\s*(\d+)$/);
        if (nextScoreM) {
          opScore = Number(nextScoreM[2]);
          scoreEnd = j + 2;
        } else {
          scoreEnd = j + 1;
        }
        break;
      }
    }

    i = scoreEnd;
    const recapLines: string[] = [];
    while (i < lines.length) {
      if (/^(?:Game\s+\d|Championship|Semi|3\s+Stars|Content copyright|Game Notes|Regular Season|Playoffs)/i.test(lines[i]!)) break;
      recapLines.push(lines[i]!);
      i++;
    }
    if (/^3\s+Stars/i.test(lines[i] ?? "")) i++;

    games.push({
      number,
      section,
      date,
      opponent,
      grScore,
      opScore,
      recap: recapLines.length > 0 ? recapLines.join(" ") : null,
      isPlayoff,
    });
  }

  return games;
}

/**
 * The scored games only — what `site.json.recaps` is and has always been.
 *
 * A fixture with no score is a real game and is kept by `parseRecapFixtures`
 * for the game record, but it is not a RESULT and the season pages render
 * these as results.
 */
export function parseGameRecaps(html: string): RecapGame[] {
  const out: RecapGame[] = [];
  for (const f of parseRecapFixtures(html)) {
    if (f.grScore === null || f.opScore === null) continue;
    out.push({
      number: f.number,
      date: f.date,
      opponent: f.opponent,
      grScore: f.grScore,
      opScore: f.opScore,
      recap: f.recap,
      isPlayoff: f.isPlayoff,
    });
  }
  return out;
}
